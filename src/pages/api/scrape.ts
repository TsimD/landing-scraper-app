// src/pages/api/scrape.ts


// Импорт внешних библиотек
import * as cheerio from 'cheerio';
// Next.js API типы
import { NextApiRequest, NextApiResponse } from 'next'; 
import { downloadFile } from '../../utils/download';
// Puppeteer
import puppeteer, { Browser, Page } from 'puppeteer';
// Chromium для Vercel
import chromium from '@sparticuz/chromium';
import archiver from 'archiver';

// --- ИНТЕРФЕЙСЫ ---

// Интерфейс для результата парсинга
interface ScrapingResult {
    // ИСПРАВЛЕНИЕ: html теперь опционален, так как при ошибке он отсутствует
    html?: string; 
    success: boolean;
    error?: string;
}

// Интерфейс для элемента, который нужно найти
interface ResourceItem {
    selector: string;
    attr: string;
    type: string; // 'img', 'css', 'js'
}

// Интерфейс для скачиваемого ресурса
interface DownloadableResource {
    type: string;
    url: string;
    // ИСПРАВЛЕНИЕ: Тип Cheerio заменен на 'any' для обхода конфликтов типов
    element: any; 
    attrName: string;
}

// Список ресурсов для извлечения
const resourceElements: ResourceItem[] = [
    { selector: 'link[rel="stylesheet"]', attr: 'href', type: 'css' },
    { selector: 'script[src]', attr: 'src', type: 'js' },
    { selector: 'img[src]', attr: 'src', type: 'img' },
];

// --- ФУНКЦИЯ ПАРСИНГА С ИСПОЛЬЗОВАНИЕМ PUPPETEER ---
// ИСПРАВЛЕНИЕ: Явно указываем типы параметров и возвращаемого значения
async function scrapeUrl(url: string): Promise<ScrapingResult> {
    let browser: Browser | null = null;

    try {
        // Настройка Puppeteer для Vercel (используя @sparticuz/chromium)
        browser = await puppeteer.launch({
            args: [
                ...chromium.args, 
                '--hide-scrollbars', 
                '--disable-web-security',
                // КРИТИЧЕСКИ ВАЖНО для Vercel/Linux
                '--no-sandbox', 
                '--disable-setuid-sandbox'
            ],
            executablePath: await chromium.executablePath(), 
            // ИСПРАВЛЕНИЕ: Установка 'new' с приведением к 'any'
            headless: 'new' as any, 
            // ИСПРАВЛЕНИЕ: Удалено, т.к. не существует в типах LaunchOptions
            // ignoreHTTPSErrors: true, 
        });

        // Явно указываем тип Page
        const page: Page = await browser.newPage(); 
        
        await page.goto(url, { waitUntil: 'networkidle0' });
        
        const htmlContent = await page.content();

        return { success: true, html: htmlContent };

    } catch (error: any) { // Явно типизируем error
        console.error('Scraping Error:', error);
        // ИСПРАВЛЕНИЕ: html теперь опционален
        return { success: false, error: error.message }; 
    } finally {
        if (browser !== null) {
            await browser.close();
        }
    }
}

// --- ГЛАВНЫЙ ОБРАБОТЧИК ---
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    const { url } = req.body;

    if (!url) {
        return res.status(400).json({ error: 'URL is required' });
    }

    // 1. ПАРСИНГ СТРАНИЦЫ
    const result: ScrapingResult = await scrapeUrl(url);

    if (!result.success) {
        // Возвращаем 500, если парсинг не удался
        return res.status(500).json({ error: result.error || 'Scraping failed by Puppeteer.' });
    }

    // 2. ОБРАБОТКА КОНТЕНТА И СКАЧИВАНИЕ

    // ИСПРАВЛЕНИЕ: Используем '!' для утверждения, что html существует после проверки success: true
    const htmlContent: string = result.html!; 
    const baseUrl: string = new URL(url).origin;
    // Типизация Cheerio
    const $: cheerio.CheerioAPI = cheerio.load(htmlContent);

    const downloadableResources: DownloadableResource[] = [];

    resourceElements.forEach((item: ResourceItem) => {
        // ИСПРАВЛЕНИЕ: Тип элемента Cheerio заменен на 'any'
        $(item.selector).each((i: number, el: any) => { 
            const path: string | undefined | null = $(el).attr(item.attr);

            if (path) {
                const fullUrl = new URL(path, baseUrl).href;
                
                downloadableResources.push({
                    type: item.type,
                    url: fullUrl,
                    element: el,
                    attrName: item.attr,
                });
            }
        });
    });

    // 3. ЗАМЕНА ССЫЛОК И СКАЧИВАНИЕ
    const filesToArchive: { path: string; data: Buffer }[] = [];

    for (const resource of downloadableResources) {
        try {
            const data = await downloadFile(resource.url);
            const fileName = `${resource.type}/${data.fileName}`;
            filesToArchive.push({ path: fileName, data: data.fileBuffer });

            // Замена исходного URL на локальный путь в HTML
            $(resource.element).attr(resource.attrName, fileName);

        } catch (error) {
            console.error(`Error downloading ${resource.url}:`, error);
        }
    }

    // Обновленный HTML
    const updatedHtml = $.html();
    filesToArchive.push({ path: 'index.html', data: Buffer.from(updatedHtml, 'utf-8') });

    // 4. АРХИВАЦИЯ И ОТПРАВКА
    try {
     
        const archive = archiver('zip', { zlib: { level: 9 } });
        
        // Буфер для сбора данных архива
        const archiveBuffers: Buffer[] = [];
        archive.on('data', (data: Buffer) => {
            archiveBuffers.push(data);
        });
        
        // Обработчик завершения
        archive.on('end', () => {
            const finalZipBuffer = Buffer.concat(archiveBuffers);

            res.setHeader('Content-Type', 'application/zip');
            res.setHeader('Content-Disposition', 'attachment; filename="scraped_landing.zip"');
            res.status(200).send(finalZipBuffer);
        });

        // Добавление файлов в архив
        filesToArchive.forEach(file => {
            archive.append(file.data, { name: file.path });
        });

        archive.finalize();
        
    } catch (error) {
        console.error('Archiving Error:', error);
        res.status(500).json({ error: 'Failed to create archive.' });
    }
}