import {
  IMG_MAX_DIM,
  IMG_WEBP_QUALITY,
  IMG_MAX_PAYLOAD,
  DuckImagePart,
} from './duck-protocol';

export interface ConvertedWebPAttachment {
  id: string;
  name: string;
  originalSizeKB: number;
  webpSizeKB: number;
  width: number;
  height: number;
  qualityUsed: number;
  part: DuckImagePart;
}

/**
 * Mirrors `image_to_data_url` in duck_cli.py:
 * - Converts any image (JPEG, PNG, WebP, GIF) to WebP data URL
 * - Fills white background (255, 255, 255) for RGBA transparency
 * - Downscales if max(w, h) > IMG_MAX_DIM (1568)
 * - Starts at quality 85%, stepping down by 15% if payload > 3,500,000 bytes
 */
export async function convertFileToWebP(file: File): Promise<ConvertedWebPAttachment> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error(`خواندن فایل تصویر ناموفق بود: ${file.name}`));
    reader.onload = () => {
      const img = new window.Image();
      img.onerror = () => reject(new Error(`بازکردن تصویر ناموفق بود: ${file.name}`));
      img.onload = () => {
        try {
          let w = img.naturalWidth || img.width;
          let h = img.naturalHeight || img.height;
          const scale = Math.max(w, h) / IMG_MAX_DIM;
          if (scale > 1) {
            w = Math.round(w / scale);
            h = Math.round(h / scale);
          }

          const canvas = document.createElement('canvas');
          canvas.width = w;
          canvas.height = h;
          const ctx = canvas.getContext('2d');
          if (!ctx) {
            reject(new Error('مرورگر از پردازش Canvas پشتیبانی نمی‌کند'));
            return;
          }

          // White background for RGBA transparency (matches duck_cli.py)
          ctx.fillStyle = '#FFFFFF';
          ctx.fillRect(0, 0, w, h);
          ctx.drawImage(img, 0, 0, w, h);

          let q = IMG_WEBP_QUALITY;
          let dataUrl = canvas.toDataURL('image/webp', q / 100);

          while (dataUrl.length > IMG_MAX_PAYLOAD && q > 30) {
            q -= 15;
            dataUrl = canvas.toDataURL('image/webp', q / 100);
          }

          if (dataUrl.length > IMG_MAX_PAYLOAD) {
            reject(
              new Error(`تصویر پس از فشرده‌سازی WebP همچنان بزرگ‌تر از ۳.۵ مگابایت است: ${file.name}`)
            );
            return;
          }

          // Ensure header starts with data:image/webp;base64,
          if (!dataUrl.startsWith('data:image/webp;base64,')) {
            const b64Part = dataUrl.split(',')[1] || '';
            dataUrl = `data:image/webp;base64,${b64Part}`;
          }

          const webpBytes = Math.round(((dataUrl.split(',')[1] || '').length * 3) / 4);

          resolve({
            id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            name: file.name,
            originalSizeKB: Math.max(1, Math.round(file.size / 1024)),
            webpSizeKB: Math.max(1, Math.round(webpBytes / 1024)),
            width: w,
            height: h,
            qualityUsed: q,
            part: {
              type: 'image',
              mimeType: 'image/webp',
              image: dataUrl,
            },
          });
        } catch (err: any) {
          reject(new Error(err?.message || 'خطا در تبدیل تصویر به WebP'));
        }
      };
      img.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  });
}

export async function convertDataUrlToWebP(
  sourceDataUrl: string,
  filename = 'edited-image.webp'
): Promise<ConvertedWebPAttachment> {
  return new Promise((resolve, reject) => {
    const img = new window.Image();
    img.onerror = () => reject(new Error('بارگذاری تصویر برای ویرایش ناموفق بود'));
    img.onload = () => {
      try {
        let w = img.naturalWidth || img.width || 1024;
        let h = img.naturalHeight || img.height || 1024;
        const maxEditDim = 1024;
        const scale = Math.max(w, h) / maxEditDim;
        if (scale > 1) {
          w = Math.round(w / scale);
          h = Math.round(h / scale);
        }

        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('مرورگر از پردازش Canvas پشتیبانی نمی‌کند'));
          return;
        }

        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(0, 0, w, h);
        ctx.drawImage(img, 0, 0, w, h);

        let q = 82;
        let dataUrl = canvas.toDataURL('image/webp', q / 100);
        while (dataUrl.length > 420_000 && q > 35) {
          q -= 15;
          dataUrl = canvas.toDataURL('image/webp', q / 100);
        }

        if (!dataUrl.startsWith('data:image/webp;base64,')) {
          const b64Part = dataUrl.split(',')[1] || '';
          dataUrl = `data:image/webp;base64,${b64Part}`;
        }

        const webpBytes = Math.round(((dataUrl.split(',')[1] || '').length * 3) / 4);
        const sizeKB = Math.max(1, Math.round(webpBytes / 1024));

        resolve({
          id: `edit-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          name: filename,
          originalSizeKB: sizeKB,
          webpSizeKB: sizeKB,
          width: w,
          height: h,
          qualityUsed: q,
          part: {
            type: 'image',
            mimeType: 'image/webp',
            image: dataUrl,
          },
        });
      } catch (err: any) {
        reject(new Error(err?.message || 'خطا در آماده‌سازی تصویر برای ویرایش'));
      }
    };
    img.src = sourceDataUrl;
  });
}

