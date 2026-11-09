import type {NextConfig} from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  experimental: { cpus: 1 },
  eslint: {
    ignoreDuringBuilds: true,
  },
  typescript: {
    ignoreBuildErrors: false,
  },
  // Allow access to remote image placeholder.
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'picsum.photos',
        port: '',
        pathname: '/**', // This allows any path under the hostname
      },
    ],
  },
  output: 'standalone',
  // ریشه ردیابی فایل ها همین پوشه پروژه باشد تا خروجی standalone مسیر تو در تو نگیرد.
  outputFileTracingRoot: process.cwd(),
  // استقرار زیر یک مسیر (مثلا /chatai): هنگام build، NEXT_PUBLIC_BASE_PATH=/chatai. بدون آن روی ریشه.
  basePath: process.env.NEXT_PUBLIC_BASE_PATH || undefined,
  serverExternalPackages: ['jsdom', 'sharp', 'undici'],
  transpilePackages: ['motion'],
  webpack: (config, {dev}) => {
    // HMR is disabled in AI Studio via DISABLE_HMR env var.
    // Do not modify—file watching is disabled to prevent flickering during agent edits.
    if (dev && process.env.DISABLE_HMR === 'true') {
      config.watchOptions = {
        ignored: /.*/,
      };
    }
    return config;
  },
};

export default nextConfig;
