// src/pages/api/scrape.ts

import { NextApiRequest, NextApiResponse } from 'next';
import * as puppeteer from 'puppeteer-core';
import chromium from '@sparticuz/chromium';
import archiver from 'archiver';
import { supabase } from '../../utils/supabase';

// Указываем, что это Serverless Function, работающая на Node.js
export const config = {
  runtime: 'nodejs',
  // Увеличиваем лимит размера тела запроса, хотя для GET-запроса это менее критично
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
  let taskId: number | null = null; // Для сохранения ID задачи

  try {
    // 1. Создаем запись о начале задачи в Supabase
    const { data: taskData, error: insertError } = await supabase
      .from('tasks')
      .insert([{ url, status: 'SCRAPING_STARTED', created_at: new Date().toISOString() }])
      .select('id')
      .single();

    if (insertError) {
      console.error('Supabase Insert Error:', insertError);
      // Не прерываем выполнение, но записываем ошибку в лог
    }

    if (taskData) {
      taskId = taskData.id;
    }

    // 2. Настройка и запуск Chromium
    browser = await puppeteer.launch({
      // Используем аргументы, настройки и путь, предоставленные @sparticuz/chromium
      args: [...chromium.args, '--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
      defaultViewport: chromium.defaultViewport,
      executablePath: await chromium.executablePath(),
      headless: 'new', // 'new' - современный, более стабильный режим
    });

    const page = await browser.newPage();

    // 3. Блокировка ненужных ресурсов (для повышения скорости и обхода ошибки 'path')
    await page.setRequestInterception(true);
    page.on('request', (request) => {
      // Блокируем стили, изображения, шрифты и медиа, чтобы Puppeteer не пытался 
      // скачать их и не вызывал ошибку 'path' при сохранении.
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
    await page.waitForSelector(elementSelector as string, { timeout: 10000 });

    // 6. Получаем целевой элемент и делаем скриншот
    const element = await page.$(elementSelector as string);

    if (!element) {
      throw new Error(`Element with selector "${elementSelector}" not found.`);
    }

    const screenshotBuffer = await element.screenshot({ type: 'png' });
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

    // Финализируем архив (отправляем его клиенту)
    await archive.finalize();

    // 8. Обновляем статус задачи в Supabase (после успешной отправки)
    if (taskId) {
      await supabase
        .from('tasks')
        .update({ status: 'DONE' })
        .eq('id', taskId);
    }

  } catch (error) {
    console.error('Scraping Error:', error);

    // Обновляем статус задачи как ошибочный (если ID доступен)
    if (taskId) {
      await supabase
        .from('tasks')
        .update({ status: 'FAILED', error_message: String(error) })
        .eq('id', taskId);
    }

    // Если ответ еще не был отправлен (например, ошибка произошла до archive.finalize)
    if (!res.headersSent) {
      return res.status(500).json({ error: 'Failed to complete scraping process.', details: String(error) });
    }
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}