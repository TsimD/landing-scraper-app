// next.config.ts

import { NextConfig } from 'next';

const nextConfig: NextConfig = {
  transpilePackages: ['@sparticuz/chromium'],
  
  // ДОБАВЛЯЕМ ЭТОТ БЛОК!
  webpack: (config, { isServer }) => {
    if (isServer) {
      // Игнорируем модули, которые Puppeteer пытается загрузить,
      // но которые Vercel не может найти в бандле.
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
      });
    }
    return config;
  },
  
  // Мы снова добавляем webpack, но Turbopack будет ругаться предупреждением, 
  // но пропустит сборку, потому что это критически важно.
};

export default nextConfig;