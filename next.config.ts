// next.config.ts

import { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // ЭТА НАСТРОЙКА КРИТИЧЕСКИ ВАЖНА для @sparticuz/chromium!
  transpilePackages: ['@sparticuz/chromium'],

  // ИСПРАВЛЕНИЕ: Добавляем пустой объект turbopack, чтобы подавить ошибку конфликта
  // с кастомным webpack (Turbopack, TIP: ... simply setting an empty turbopack config...).
  turbopack: {}, 
  
  // БЛОК WEBPACK ДОЛЖЕН БЫТЬ ОСТАВЛЕН, чтобы обработать externals для Puppeteer
  webpack: (config, { isServer }) => {
    if (isServer) {
      // Игнорируем модули, которые Puppeteer пытается загрузить, но которые Vercel не может найти
      config.externals.push(
        'perf_hooks',
        'child_process',
        'fs',
        'path',
        'os',
        'url',
        'readline',
        'http',
        'https',
        'stream',
        'process',
      );
    }
    return config;
  },
};

export default nextConfig;