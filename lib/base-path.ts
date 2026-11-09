// الگوی استقرار زیر یک مسیر (مثلا https://example.com/chatai): هنگام build مقدار
// NEXT_PUBLIC_BASE_PATH=/chatai را بگذارید. بدون آن، برنامه روی ریشه کار می کند.
export const BASE_PATH = (process.env.NEXT_PUBLIC_BASE_PATH || '').replace(/\/+$/, '');

/** آدرس درخواست به API همین برنامه، با در نظر گرفتن basePath. */
export function apiUrl(path: string): string {
  return `${BASE_PATH}${path}`;
}
