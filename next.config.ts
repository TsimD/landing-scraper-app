// next.config.ts

import { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Добавляем конфигурацию Webpack для обработки внешних модулей
  webpack: (config, { isServer }) => {
    // Эта настройка применяется только на стороне сервера (для API-маршрутов)
    if (isServer) {
      // ИСПРАВЛЕНИЕ: Нужно явно приводить externals к строковому массиву,
      // или использовать spread-оператор, если он уже массив.
      // В данном случае, это наиболее чистый способ.
      if (!config.externals) {
        config.externals = [];
      }
      // Приводим к известному нам типу, чтобы TS не ругался
      (config.externals as (string | RegExp)[]).push('@sparticuz/chromium');
    }
    return config;
  },

  // Оставим experimental для полной уверенности, хотя webpack должен сработать
  experimental: {
    serverComponentsExternalPackages: ['@sparticuz/chromium'],
  },
};

// Используем export default вместо module.exports
export default nextConfig;