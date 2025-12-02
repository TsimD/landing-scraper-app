// pages/api/scrape.js

import * as cheerio from 'cheerio';
import { downloadFile } from '../../utils/download'; 
import { join } from 'path';
import { promises as fs } from 'fs';
import archiver from 'archiver';
import { supabase } from '../../utils/supabase';

// --- PUPPETEER ИМПОРТЫ ДЛЯ VERCEL ---
import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';
// ------------------------------------

// ФУНКЦИЯ ПАРСИНГА С ИСПОЛЬЗОВАНИЕМ PUPPETEER
async function scrapeUrl(url) {
  let browser = null;

  try {
    // Настройка Puppeteer для Vercel
    browser = await puppeteer.launch({
      args: [...chromium.args, '--hide-scrollbars', '--disable-web-security'],
      defaultViewport: chromium.defaultViewport,
      executablePath: await chromium.executablePath(), 
      headless: chromium.headless,
      ignoreHTTPSErrors: true,
    });

    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');
    await page.goto(url, { waitUntil: 'networkidle0', timeout: 60000 });

    const htmlContent = await page.content();
    return { html: htmlContent, success: true };

  } catch (error) {
    console.error('Scraping Error:', error);
    return { success: false, error: error.message };
  } finally {
    if (browser !== null) {
      await browser.close();
    }
  }
}

// ГЛАВНЫЙ ОБРАБОТЧИК
export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ message: 'Method Not Allowed' });
    }
    const { url } = req.body;
    if (!url) {
        return res.status(400).json({ message: 'URL is required' });
    }
    
    // 1. ЗАПИСЬ ЗАДАЧИ В SUPABASE (Статус: SCRAPING_STARTED)
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

    const taskId = task.id;

    // 2. ВЫЗОВ РЕАЛЬНОГО ПАРСЕРА
    const result = await scrapeUrl(url);

    if (!result.success) {
        // Обновление статуса в случае ошибки
        await supabase.from('tasks').update({ status: 'ERROR', error_message: result.error }).eq('id', taskId);
        return res.status(500).json({ message: 'Scraping failed by Puppeteer.', details: result.error });
    }

    const htmlContent = result.html;
    const baseUrl = new URL(url).origin;
    const $ = cheerio.load(htmlContent);
    const tempDir = join(process.cwd(), 'temp', Date.now().toString());
    await fs.mkdir(tempDir, { recursive: true });
    
    // --- 3. Сбор ссылок ---
    const resources = [];
    let assetCount = 0;
    const resourceElements = [
        { selector: 'link[rel="stylesheet"]', attr: 'href', type: 'css', attrName: 'href' },
        { selector: 'script[src]', attr: 'src', type: 'js', attrName: 'src' },
        { selector: 'img[src]', attr: 'src', type: 'img', attrName: 'src' },
        { selector: 'link[rel="icon"]', attr: 'href', type: 'icon', attrName: 'href' }
    ];

    resourceElements.forEach(item => {
        $(item.selector).each((i, el) => {
            const path = $(el).attr(item.attr);
            if (path && !path.startsWith('data:')) {
                const absoluteUrl = new URL(path, baseUrl).href;
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
    const downloadPromises = resources.map(async (resource, index) => {
        try {
            const urlPath = new URL(resource.url).pathname;
            const extMatch = urlPath.match(/\.([0-9a-z]+)(?:[\?#]|$)/i);
            const ext = (extMatch ? extMatch[1] : resource.type) || 'file'; 
            
            const fileName = `${resource.type}-${index}.${ext}`;
            const localPath = join(tempDir, fileName);
            
            await downloadFile(resource.url, localPath);
            
            $(resource.element).attr(resource.attrName, fileName);
            assetCount++;
            
        } catch (downloadError) {
            console.error(`Download failed for ${resource.url}: ${downloadError.message}`);
        }
    });

    await Promise.all(downloadPromises);

    // --- 5. Сохранение нового HTML ---
    const finalHtml = $.html();
    const htmlPath = join(tempDir, 'index.html');
    await fs.writeFile(htmlPath, finalHtml);

    // --- 6. Архивация и Отправка ZIP ---
    const zipFileName = 'landing-page.zip';
    const archive = archiver('zip', { zlib: { level: 9 } });
    
    res.writeHead(200, {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="${zipFileName}"`,
    });
    
    archive.pipe(res);
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