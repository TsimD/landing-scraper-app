// pages/api/scrape.ts

import * as cheerio from 'cheerio';
// Next.js API типы
import { NextApiRequest, NextApiResponse } from 'next'; 
import { downloadFile } from '../../utils/download'; 
import { join } from 'path';
import { promises as fs } from 'fs';
import archiver, { Archiver } from 'archiver'; // Типизация Archiver
import { supabase } from '../../utils/supabase';
import { Writable } from 'stream'; // Для pipe(res)

// --- PUPPETEER ИМПОРТЫ ДЛЯ VERCEL ---
import chromium from '@sparticuz/chromium';
// Используем конкретные типы из puppeteer-core
import puppeteer, { Browser, Page } from 'puppeteer-core'; 
// ------------------------------------

// --- ИНТЕРФЕЙСЫ ---

// Интерфейс для возвращаемого значения из scrapeUrl
interface ScrapingResult {
    html: string;
    success: boolean;
    error?: string;
}

// Интерфейс для элемента ресурса (для массива resources)
interface ResourceItem {
    selector: string;
    attr: string;
    type: string;
    attrName: string;
}

// Интерфейс для скачиваемого ресурса
interface DownloadableResource {
    type: string;
    url: string;
    element: cheerio.Element;
    attrName: string;
}

// ФУНКЦИЯ ПАРСИНГА С ИСПОЛЬЗОВАНИЕМ PUPPETEER
// ИСПРАВЛЕНО: Явно указываем тип параметра url
async function scrapeUrl(url: string): Promise<ScrapingResult> {
  // Явно указываем тип Browser
  let browser: Browser | null = null;

  try {
    // Настройка Puppeteer для Vercel
    browser = await puppeteer.launch({
      args: [...chromium.args, '--hide-scrollbars', '--disable-web-security'],
      defaultViewport: chromium.defaultViewport as { width: number, height: number } | null,
      executablePath: await chromium.executablePath(), 
      headless: chromium.headless as boolean | 'new', // Типы headless
      ignoreHTTPSErrors: true,
    });

    // Явно указываем тип Page
    const page: Page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');
    await page.goto(url, { waitUntil: 'networkidle0', timeout: 60000 });

    const htmlContent: string = await page.content();
    return { html: htmlContent, success: true };

  } catch (error: any) { // Явно типизируем error
    console.error('Scraping Error:', error);
    return { success: false, error: error.message };
  } finally {
    if (browser !== null) {
      await browser.close();
    }
  }
}

// ГЛАВНЫЙ ОБРАБОТЧИК
// ИСПРАВЛЕНО: Явно типизируем req и res
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
    if (req.method !== 'POST') {
        return res.status(405).json({ message: 'Method Not Allowed' });
    }
    
    // Деструктуризация с проверкой типа
    const { url } = req.body as { url: string }; 
    if (!url) {
        return res.status(400).json({ message: 'URL is required' });
    }
    
    // 1. ЗАПИСЬ ЗАДАЧИ В SUPABASE (Статус: SCRAPING_STARTED)
    // Явно указываем тип для task
    const { data: task, error: dbError } = await supabase
        .from('tasks')
        // user_id: null, т.к. RLS отключен, и мы не настроили аутентификацию
        .insert([{ url: url, status: 'SCRAPING_STARTED', user_id: null }])
        .select()
        .single();
    
    if (dbError) {
        console.error('DB Error:', dbError);
        return res.status(500).json({ message: 'Failed to record task in DB.' });
    }

    const taskId: string = (task as { id: string }).id; // Приведение типа
    
    // 2. ВЫЗОВ РЕАЛЬНОГО ПАРСЕРА
    const result: ScrapingResult = await scrapeUrl(url);

    if (!result.success) {
        // Обновление статуса в случае ошибки
        await supabase.from('tasks').update({ status: 'ERROR', error_message: result.error }).eq('id', taskId);
        return res.status(500).json({ message: 'Scraping failed by Puppeteer.', details: result.error });
    }

    const htmlContent: string = result.html;
    const baseUrl: string = new URL(url).origin;
    // Типизация Cheerio
    const $: cheerio.CheerioAPI = cheerio.load(htmlContent);
    const tempDir: string = join(process.cwd(), 'temp', Date.now().toString());
    await fs.mkdir(tempDir, { recursive: true });
    
    // --- 3. Сбор ссылок ---
    const resources: DownloadableResource[] = [];
    let assetCount: number = 0;
    // Явно типизируем массив элементов
    const resourceElements: ResourceItem[] = [
        { selector: 'link[rel="stylesheet"]', attr: 'href', type: 'css', attrName: 'href' },
        { selector: 'script[src]', attr: 'src', type: 'js', attrName: 'src' },
        { selector: 'img[src]', attr: 'src', type: 'img', attrName: 'src' },
        { selector: 'link[rel="icon"]', attr: 'href', type: 'icon', attrName: 'href' }
    ];

    resourceElements.forEach((item: ResourceItem) => {
        $(item.selector).each((i: number, el: cheerio.Element) => {
            const path: string | undefined | null = $(el).attr(item.attr);
            if (path && !path.startsWith('data:')) {
                const absoluteUrl: string = new URL(path, baseUrl).href;
                resources.push({ 
                    type: item.type, 
                    url: absoluteUrl, 
                    element: el,
                    attrName: item.attr
                });
            }
        });
    });

    // --- 4. Скачивание и Перезапись Путей ---
    // Типизация промисов
    const downloadPromises: Promise<void>[] = resources.map(async (resource: DownloadableResource, index: number): Promise<void> => {
        try {
            const urlPath: string = new URL(resource.url).pathname;
            const extMatch: RegExpMatchArray | null = urlPath.match(/\.([0-9a-z]+)(?:[\?#]|$)/i);
            const ext: string = (extMatch ? extMatch[1] : resource.type) || 'file'; 
            
            const fileName: string = `${resource.type}-${index}.${ext}`;
            const localPath: string = join(tempDir, fileName);
            
            await downloadFile(resource.url, localPath);
            
            $(resource.element).attr(resource.attrName, fileName);
            assetCount++;
            
        } catch (downloadError: any) {
            console.error(`Download failed for ${resource.url}: ${downloadError.message}`);
        }
    });

    await Promise.all(downloadPromises);

    // --- 5. Сохранение нового HTML ---
    const finalHtml: string = $.html();
    const htmlPath: string = join(tempDir, 'index.html');
    await fs.writeFile(htmlPath, finalHtml);

    // --- 6. Архивация и Отправка ZIP ---
    const zipFileName: string = 'landing-page.zip';
    // Явно указываем тип Archiver
    const archive: Archiver = archiver('zip', { zlib: { level: 9 } });
    
    // Настройка заголовков ответа
    res.writeHead(200, {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="${zipFileName}"`,
    });
    
    // pipe(res) - res является Writable stream
    archive.pipe(res as Writable); 
    archive.directory(tempDir, false);
    
    await archive.finalize();
    
    // 7. ОБНОВЛЕНИЕ СТАТУСА: ГОТОВО
    const { error: updateError } = await supabase
        .from('tasks')
        .update({ status: 'DONE', assets_count: assetCount })
        .eq('id', taskId);

    if (updateError) {
        console.error('DB UPDATE ERROR:', updateError);
    }
    
    // 8. Очистка (пока убрали fs.rm)
    // await fs.rm(tempDir, { recursive: true, force: true }); 
}