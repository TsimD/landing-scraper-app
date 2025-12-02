// next.config.ts

import { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // ИСПРАВЛЕНИЕ: Вернуть старое название опции, 
  // но обернуть 'experimental' в 'as any', 
  // чтобы TypeScript не выдавал ошибку компиляции на Next.js 16.0.6.
  
  experimental: {
    // ВАШЕЙ ВЕРСИИ НУЖНО ИМЕННО ЭТО ИМЯ:
    serverComponentsExternalPackages: ['@sparticuz/chromium'],
  } as any, 
  // Приведение к 'any' - это последний способ заставить Next.js принять 
  // экспериментальный флаг, который не обновлен в ваших @types.
};

export default nextConfig;