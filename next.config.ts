// next.config.ts

import { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // 1. Принудительно включаем пакет в сборку
  transpilePackages: ['@sparticuz/chromium'],

  experimental: {
    // 2. КРИТИЧЕСКИ ВАЖНО: Явно указываем Vercel скопировать бинарные файлы Chromium
    // в папку функции /api/scrape. Это решает ошибку "directory does not exist".
    outputFileTracingIncludes: {
      '/api/scrape': ['./node_modules/@sparticuz/chromium/bin/**/*'],
    },
    // Также помечаем как внешний пакет
    serverComponentsExternalPackages: ['@sparticuz/chromium'],
  } as any, // as any для обхода старых типов Next.js

  // 3. Пустой объект для подавления конфликта с Turbopack
  turbopack: {},

  // 4. Конфигурация Webpack для игнорирования Node.js модулей в Puppeteer
  webpack: (config, { isServer }) => {
    if (isServer) {
      config.externals.push({
        'perf_hooks': 'perf_hooks',
        'child_process': 'child_process',
        'fs': 'fs',
        'path': 'path',
        'os': 'os',
        'url': 'url',
        'readline': 'readline',
        'http': 'http',
        'https': 'https',
        'stream': 'stream',
        'process': 'process',
        // Добавляем puppeteer в исключения, чтобы он не бандлился Webpack-ом
        'puppeteer': 'puppeteer', 
      });
    }
    return config;
  },
};

export default nextConfig;