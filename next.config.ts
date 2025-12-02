// next.config.ts

import { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // 1. Обозначаем пакеты как "внешние".
  // Это говорит Next.js не пытаться упаковать их внутрь JS-файла, а оставить в node_modules.
  // Это автоматически решает проблемы с 'fs', 'path' и другими Node.js модулями внутри Puppeteer.
  serverExternalPackages: ['@sparticuz/chromium', 'puppeteer', 'archiver'],

  // 2. Принудительно копируем бинарные файлы Chromium в лямбда-функцию.
  // Это решает ошибку "directory .../bin does not exist".
  outputFileTracingIncludes: {
    '/api/scrape': ['./node_modules/@sparticuz/chromium/bin/**/*'],
  },

  // МЫ УДАЛИЛИ transpilePackages и webpack, так как они вызывали конфликты.
} as any; // Кастуем к any, чтобы TypeScript не блокировал сборку из-за новых ключей Next.js 16

export default nextConfig;