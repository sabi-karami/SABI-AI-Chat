'use client';

import React, { useState, useEffect } from 'react';
import {
  X,
  Download,
  ZoomIn,
  ZoomOut,
  Wand2,
  ArrowUp,
} from 'lucide-react';
import { ImageAspectRatio } from '@/lib/duck-protocol';

export interface LightboxImageItem {
  dataUri: string;
  downloadName: string;
  width?: number;
  height?: number;
  aspectRatio?: ImageAspectRatio;
}

interface ImageLightboxModalProps {
  item: LightboxImageItem | null;
  onClose: () => void;
  onSubmitImageEdit: (
    sourceDataUri: string,
    editPrompt: string,
    aspectRatio?: ImageAspectRatio
  ) => void;
  isStreaming?: boolean;
}

export function ImageLightboxModal({
  item,
  onClose,
  onSubmitImageEdit,
  isStreaming = false,
}: ImageLightboxModalProps) {
  const [zoom, setZoom] = useState<number>(1);
  const [editPrompt, setEditPrompt] = useState<string>('');

  useEffect(() => {
    setZoom(1);
    setEditPrompt('');
  }, [item?.dataUri]);

  useEffect(() => {
    if (!item) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [item, onClose]);

  if (!item) return null;

  const handleSubmit = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const trimmed = editPrompt.trim();
    if (!trimmed || isStreaming) return;
    onSubmitImageEdit(item.dataUri, trimmed, item.aspectRatio);
    setEditPrompt('');
    onClose();
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="نمای تمام‌صفحه و ویرایش تصویر"
      className="fixed inset-0 z-50 bg-black/92 backdrop-blur-md flex flex-col justify-between select-none"
    >
      {/* Top Toolbar */}
      <div className="h-16 px-4 sm:px-6 flex items-center justify-between gap-3 border-b border-zinc-800/80 bg-zinc-950/70 z-20">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onClose}
            aria-label="بستن بزرگ‌نمایی تصویر"
            className="min-h-[40px] min-w-[40px] rounded-2xl bg-zinc-900 hover:bg-zinc-800 text-zinc-200 flex items-center justify-center transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
          {item.width && item.height && (
            <span
              dir="ltr"
              className="hidden sm:inline-block px-2.5 py-1 rounded-xl bg-zinc-900 text-zinc-400 text-xs tabular-nums"
            >
              {item.width}×{item.height}
            </span>
          )}
        </div>

        {/* Zoom Controls */}
        <div
          dir="ltr"
          className="flex items-center gap-1 bg-zinc-900/90 border border-zinc-800 rounded-2xl p-1"
        >
          <button
            type="button"
            onClick={() => setZoom((z) => Math.max(0.5, Number((z - 0.25).toFixed(2))))}
            aria-label="کوچک‌نمایی"
            className="p-2 rounded-xl text-zinc-300 hover:text-white hover:bg-zinc-800 transition-colors cursor-pointer"
          >
            <ZoomOut className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={() => setZoom(1)}
            aria-label="اندازه اصلی"
            className="px-2.5 py-1 rounded-xl text-xs font-semibold text-zinc-300 hover:text-white hover:bg-zinc-800 tabular-nums transition-colors cursor-pointer"
          >
            {Math.round(zoom * 100)}%
          </button>
          <button
            type="button"
            onClick={() => setZoom((z) => Math.min(2.5, Number((z + 0.25).toFixed(2))))}
            aria-label="بزرگ‌نمایی"
            className="p-2 rounded-xl text-zinc-300 hover:text-white hover:bg-zinc-800 transition-colors cursor-pointer"
          >
            <ZoomIn className="w-4 h-4" />
          </button>
        </div>

        {/* Download Button */}
        <a
          href={item.dataUri}
          download={item.downloadName}
          className="min-h-[40px] px-3.5 py-2 rounded-2xl bg-zinc-100 text-zinc-950 font-semibold text-xs flex items-center gap-1.5 hover:opacity-90 transition-opacity"
        >
          <Download className="w-4 h-4" />
          <span>دانلود تصویر</span>
        </a>
      </div>

      {/* Center Image Canvas Area */}
      <div
        onClick={onClose}
        className="flex-1 overflow-auto flex items-center justify-center p-4 sm:p-8"
      >
        <img
          src={item.dataUri}
          alt="نمای بزرگ تصویر"
          referrerPolicy="no-referrer"
          onClick={(e) => e.stopPropagation()}
          style={{
            transform: `scale(${zoom})`,
            transition: 'transform 180ms ease-out',
          }}
          className="max-h-[70dvh] max-w-[92vw] w-auto h-auto rounded-2xl shadow-2xl border border-zinc-800 object-contain"
        />
      </div>

      {/* Bottom Image Edit Prompt Bar */}
      <div className="w-full max-w-2xl mx-auto px-4 pb-5 pt-2 z-20">
        <form
          onSubmit={handleSubmit}
          className="rounded-3xl bg-zinc-900/95 border border-zinc-700/80 px-3.5 py-2 flex items-center gap-2.5 shadow-xl"
        >
          <Wand2 className="w-5 h-5 text-amber-500 shrink-0" />
          <input
            type="text"
            value={editPrompt}
            onChange={(e) => setEditPrompt(e.target.value)}
            placeholder="چه تغییری در این تصویر اعمال شود؟ (مثلاً: پس‌زمینه را شب کن)..."
            aria-label="دستور ویرایش تصویر"
            autoFocus
            className="flex-1 min-w-0 bg-transparent text-sm text-zinc-100 placeholder:text-zinc-400 focus:outline-none py-1.5"
          />
          <button
            type="submit"
            disabled={!editPrompt.trim() || isStreaming}
            aria-label="اعمال ویرایش روی تصویر"
            className="min-h-[38px] min-w-[38px] rounded-full bg-amber-500 hover:bg-amber-400 disabled:bg-zinc-800 text-zinc-950 disabled:text-zinc-600 flex items-center justify-center transition-colors cursor-pointer disabled:cursor-not-allowed shrink-0"
          >
            <ArrowUp className="w-4 h-4" />
          </button>
        </form>
      </div>
    </div>
  );
}
