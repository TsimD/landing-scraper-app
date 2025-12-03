// src/pages/api/scrape.ts

import { NextApiRequest, NextApiResponse } from 'next';
import * as puppeteer from 'puppeteer-core'; 
import chromium from '@sparticuz/chromium';
import archiver from 'archiver';
import { supabase } from '../../utils/supabase';
// Node.js Buffer нужен для совместимости с archiver в TypeScript
import { Buffer } from 'buffer';

// Указываем, что это Serverless Function, работающая на Node.js
export const config = {
  runtime: 'nodejs',
  api: {
    bodyParser: {
      sizeLimit: '1mb',
    },
  },
};

/**
 * Обрабатывает запрос на скрапинг и возвращает ZIP-архив.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const { url: rawUrl, elementSelector } = req.query;

  if (!rawUrl || typeof rawUrl !== 'string') {
    return res.status(400).json({ error: 'Missing or invalid URL' });
  }

  const url = rawUrl.startsWith('http') ? rawUrl : `https://${rawUrl}`;
  let browser: puppeteer.Browser | null = null; 
  let taskId: number | null = null; 

  try {
    // 1. Создаем запись о начале задачи в Supabase
    const { data: taskData, error: insertError } = await supabase
      .from('tasks')
      .insert([{ url, status: 'SCRAPING_STARTED', created_at: new Date().toISOString() }])
      .select('id')
      .single();

    if (insertError) {
      console.error('Supabase Insert Error:', insertError);
    }

    if (taskData) {
      taskId = taskData.id;
    }

    // 2. Настройка и запуск Chromium
    browser = await puppeteer.launch({
      args: [
        ...chromium.args, 
        '--no-sandbox', 
        '--disable-setuid-sandbox', 
        '--disable-dev-shm-usage'
      ],
      executablePath: await chromium.executablePath(),
      headless: true, 
    });

    const page = await browser.newPage();

    // 3. Блокировка ненужных ресурсов (оптимизация)
    await page.setRequestInterception(true);
    page.on('request', (request) => {
      if (
        request.resourceType() === 'stylesheet' ||
        request.resourceType() === 'image' ||
        request.resourceType() === 'font' ||
        request.resourceType() === 'media'
      ) {
        request.abort();
      } else {
        request.continue();
      }
    });

    // 4. Переходим на страницу
    await page.goto(url, { waitUntil: 'domcontentloaded' });

    // 5. Ожидаем появления селектора
    await page.waitForSelector(elementSelector as string, { timeout: 5000 });

    // 6. Получаем целевой элемент и делаем скриншот
    const element = await page.$(elementSelector as string);

    if (!element) {
      throw new Error(`Element with selector "${elementSelector}" not found.`);
    }

    // ИСПРАВЛЕНИЕ: Используем as Buffer для устранения ошибки типов в сборке
    const screenshotBuffer = await element.screenshot({ type: 'png' }) as Buffer;
    const htmlContent = await element.evaluate(el => el.outerHTML);

    // 7. Создаем ZIP-архив
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="scraped_data.zip"`);

    const archive = archiver('zip', { zlib: { level: 9 } });
    archive.pipe(res);

    // Добавляем скриншот
    archive.append(screenshotBuffer, { name: 'screenshot.png' });
    // Добавляем HTML-код
    archive.append(htmlContent, { name: 'content.html' });

    // Финализируем архив
    await archive.finalize();

    // 8. Обновляем статус задачи в Supabase
    if (taskId) {
      await supabase
        .from('tasks')
        .update({ status: 'DONE' })
        .eq('id', taskId);
    }

  } catch (error) {
    console.error('Scraping Error:', error);

    if (taskId) {
      await supabase
        .from('tasks')
        .update({ status: 'FAILED', error_message: String(error) })
        .eq('id', taskId);
    }

    // Важно: проверяем, не отправлены ли заголовки, прежде чем отправить 500
    if (!res.headersSent) {
      return res.status(500).json({ error: 'Failed to complete scraping process.', details: String(error) });
    }
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}