import Link from 'next/link';

export default function NotFound() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-5 bg-zinc-50 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100">
      <span className="text-7xl" aria-hidden>
        🦆
      </span>
      <h1 className="text-5xl font-bold tracking-tight">404</h1>
      <p className="text-zinc-600 dark:text-zinc-400">
        این صفحه وجود نداره · Page not found
      </p>
      <Link
        href="/"
        className="rounded-xl bg-emerald-600 px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-emerald-500 dark:bg-emerald-500 dark:hover:bg-emerald-400"
      >
        بازگشت به گفتگو
      </Link>
    </main>
  );
}
