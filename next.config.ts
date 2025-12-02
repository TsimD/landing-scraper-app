import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  experimental: {
    // Включение внешних пакетов для серверных компонентов/API-маршрутов
    serverComponentsExternalPackages: ['@sparticuz/chromium'],
  },
};

export default nextConfig;
