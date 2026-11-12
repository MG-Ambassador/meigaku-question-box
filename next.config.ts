import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  output: 'export',
  trailingSlash: true,
  images: {
    unoptimized: true,
  },
  basePath: process.env.NEXT_PUBLIC_BASE_PATH || '',
  // 静的書き出しでは追跡結果を使わない。iCloud に退避されたフォルダを読みに行くとビルドが止まるので外す。
  outputFileTracingExcludes: {
    '*': ['outputs/**', 'legacy/**', 'dist/**', 'server/**', 'test-results/**', 'examples/**', 'docs/**'],
  },
};

export default nextConfig;
