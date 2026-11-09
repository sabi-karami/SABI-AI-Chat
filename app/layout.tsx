import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'SABI-AI',
  description:
    'کلاینت وب و موبایل DuckDuckGo AI Chat (duck.ai) با رابط کاربری شبیه ChatGPT، پشتیبانی از سوییچ مدل‌ها، ارسال تصویر WebP، تحلیل فایل‌های کد و تولید تصویر',
  openGraph: {
    title: 'SABI-AI',
    description:
      'کلاینت وب و موبایل DuckDuckGo AI Chat (duck.ai) با رابط کاربری شبیه ChatGPT، پشتیبانی از سوییچ مدل‌ها، ارسال تصویر WebP، تحلیل فایل‌های کد و تولید تصویر',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'SABI-AI',
    description:
      'کلاینت وب و موبایل DuckDuckGo AI Chat (duck.ai) با رابط کاربری شبیه ChatGPT، پشتیبانی از سوییچ مدل‌ها، ارسال تصویر WebP، تحلیل فایل‌های کد و تولید تصویر',
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fa" dir="rtl" className="dark" suppressHydrationWarning>
      <head>
        <link rel="stylesheet" href="/fonts/fonts.css" />
      </head>
      <body
        style={{ fontFamily: "'Vazirmatn', 'Plus Jakarta Sans', sans-serif" }}
        className="bg-zinc-50 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100 antialiased selection:bg-emerald-500/20 selection:text-emerald-600 dark:selection:text-emerald-300"
        suppressHydrationWarning
      >
        {children}
      </body>
    </html>
  );
}
