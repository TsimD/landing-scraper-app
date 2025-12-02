// next.config.ts

import { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Конфигурация строго типизирована интерфейсом NextConfig

  experimental: {
    // Это свойство ожидает массив строк (string[]), что проверяется TypeScript.
    serverExternalPackages: ['@sparticuz/chromium'],
  },
  
  // turbopack: {}, // Опционально, если хотите явно указать Turbopack
};

export default nextConfig;