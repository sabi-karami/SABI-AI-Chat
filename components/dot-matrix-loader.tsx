'use client';

import React, { useEffect, useRef, useState } from 'react';
import { motion } from 'motion/react';
import { ImageQualityTier, ImageAspectRatio } from '@/lib/duck-protocol';

interface DotMatrixLoaderProps {
  variant: 'sketching' | 'thinking';
  statusTitle?: string;
  hasPartialProgress?: boolean;
  quality?: ImageQualityTier;
  aspectRatio?: ImageAspectRatio;
}

export function DotMatrixLoader({
  variant,
  statusTitle,
  hasPartialProgress = false,
  quality = '2K',
  aspectRatio = '1:1',
}: DotMatrixLoaderProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [progress, setProgress] = useState<number>(variant === 'sketching' ? 4 : 8);

  useEffect(() => {
    if (variant !== 'sketching') return;
    const startMs = Date.now();
    const interval = setInterval(() => {
      const elapsedSec = (Date.now() - startMs) / 1000;
      setProgress((prev) => {
        const floor = hasPartialProgress ? 68 : 0;
        const speed = 0.16;
        const target = Math.min(
          96,
          Math.max(floor, Math.round(97 * (1 - Math.exp(-elapsedSec * speed))))
        );
        return target > prev ? target : prev;
      });
    }, 180);

    return () => clearInterval(interval);
  }, [variant, hasPartialProgress]);

  useEffect(() => {
    if (variant !== 'sketching') return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const cols = 17;
    const rows = 21;
    const width = 272;
    const height = 336;
    const dpr = typeof window !== 'undefined' ? Math.min(window.devicePixelRatio || 1, 2) : 1;

    canvas.width = width * dpr;
    canvas.height = height * dpr;
    ctx.scale(dpr, dpr);

    let rafId = 0;
    const startTime = performance.now();

    const renderFrame = (now: number) => {
      const t = (now - startTime) * 0.0018;
      ctx.clearRect(0, 0, width, height);

      const cx1 = 0.5 + 0.28 * Math.cos(t * 1.15) + 0.1 * Math.sin(t * 2.1);
      const cy1 = 0.48 + 0.28 * Math.sin(t * 0.95) + 0.08 * Math.cos(t * 1.7);

      const cx2 = 0.5 + 0.25 * Math.sin(t * 0.85 + 1.8);
      const cy2 = 0.52 + 0.24 * Math.cos(t * 1.25 + 0.9);

      const ambX = cx1 * width;
      const ambY = cy1 * height;
      const radialGrad = ctx.createRadialGradient(ambX, ambY, 8, ambX, ambY, width * 0.55);
      radialGrad.addColorStop(0, 'rgba(234, 88, 12, 0.14)');
      radialGrad.addColorStop(0.5, 'rgba(180, 60, 20, 0.06)');
      radialGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');
      ctx.fillStyle = radialGrad;
      ctx.fillRect(0, 0, width, height);

      const padX = 18;
      const padY = 18;
      const stepX = (width - padX * 2) / (cols - 1);
      const stepY = (height - padY * 2) / (rows - 1);

      for (let r = 0; r < rows; r++) {
        const ny = r / (rows - 1);
        const y = padY + r * stepY;

        for (let c = 0; c < cols; c++) {
          const nx = c / (cols - 1);
          const x = padX + c * stepX;

          const d1 = Math.hypot(nx - cx1, (ny - cy1) * (rows / cols));
          const d2 = Math.hypot(nx - cx2, (ny - cy2) * (rows / cols));

          const w1 = Math.exp(-d1 * d1 * 9.5);
          const w2 = Math.exp(-d2 * d2 * 12.0) * 0.75;
          const ripple = 0.5 + 0.5 * Math.sin(d1 * 14 - t * 3.2);

          const intensity = Math.min(1, Math.max(0, w1 * 0.85 + w2 * 0.55 + w1 * ripple * 0.25));

          const red = Math.round(48 + intensity * 207);
          const green = Math.round(28 + Math.pow(intensity, 1.25) * 118);
          const blue = Math.round(22 + Math.pow(intensity, 1.9) * 68);
          const alpha = 0.28 + intensity * 0.72;

          const radius = 1.25 + intensity * 0.95;

          ctx.beginPath();
          ctx.arc(x, y, radius, 0, Math.PI * 2);
          ctx.fillStyle = `rgba(${red}, ${green}, ${blue}, ${alpha.toFixed(3)})`;
          ctx.fill();
        }
      }

      rafId = requestAnimationFrame(renderFrame);
    };

    rafId = requestAnimationFrame(renderFrame);
    return () => cancelAnimationFrame(rafId);
  }, [variant]);

  const label =
    statusTitle ||
    (variant === 'sketching' ? 'در حال طراحی تصویر...' : 'در حال فکر کردن...');

  return (
    <div
      data-testid={`dot-matrix-${variant}`}
      className="w-full space-y-3 py-1 select-none"
    >
      {/* Top Shimmering Status Bar with Vertical Indicator Line */}
      <div className="flex items-center gap-3">
        <span
          aria-hidden="true"
          className="w-[2.5px] h-6 rounded-full bg-zinc-400 dark:bg-zinc-600 shrink-0"
        />
        <motion.span
          dir="auto"
          animate={{ backgroundPosition: ['200% 0%', '-200% 0%'] }}
          transition={{ duration: 2.6, repeat: Infinity, ease: 'linear' }}
          style={{
            backgroundImage:
              'linear-gradient(90deg, #71717a 0%, #e4e4e7 35%, #ffffff 50%, #e4e4e7 65%, #71717a 100%)',
            backgroundSize: '200% 100%',
          }}
          className="text-sm sm:text-[15px] font-medium bg-clip-text text-transparent inline-block"
        >
          {label}
        </motion.span>
      </div>

      {/* Glowing Orange Dot-Matrix Canvas Card — ONLY for image generation (sketching) */}
      {variant === 'sketching' && (
        <div
          dir="ltr"
          className="relative rounded-3xl bg-zinc-950 border border-zinc-800/80 overflow-hidden shadow-md w-full max-w-[272px] sm:max-w-[296px] aspect-[17/21]"
        >
          <canvas
            ref={canvasRef}
            aria-label={label}
            className="w-full h-full block"
          />

          <div className="absolute bottom-3.5 right-3.5 px-3 py-1 rounded-full bg-zinc-800/90 backdrop-blur-md border border-zinc-700/60 text-zinc-200 text-xs font-semibold tabular-nums shadow-xs">
            {progress}%
          </div>
        </div>
      )}
    </div>
  );
}
