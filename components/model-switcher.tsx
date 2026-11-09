'use client';

import React, { useState, useRef, useEffect } from 'react';
import { ChevronDown, Check } from 'lucide-react';
import { MODEL_OPTIONS, ModelOption } from '@/lib/duck-protocol';

interface ModelSwitcherProps {
  selectedModel: string;
  onSelectModel: (modelId: string) => void;
  externalOpen?: boolean;
  onExternalOpenChange?: (open: boolean) => void;
}

export function ModelSwitcher({
  selectedModel,
  onSelectModel,
  externalOpen,
  onExternalOpenChange,
}: ModelSwitcherProps) {
  const [internalOpen, setInternalOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const isOpen = externalOpen !== undefined ? externalOpen : internalOpen;
  const setOpen = (val: boolean) => {
    setInternalOpen(val);
    onExternalOpenChange?.(val);
  };

  const currentModel: ModelOption =
    MODEL_OPTIONS.find((m) => m.id === selectedModel) || MODEL_OPTIONS[0];

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen]);

  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        onClick={() => setOpen(!isOpen)}
        aria-label={`انتخاب مدل هوش مصنوعی، مدل فعلی ${currentModel.name}`}
        aria-expanded={isOpen}
        className="min-h-[44px] px-3.5 py-2 rounded-2xl flex items-center gap-2 text-[15px] font-semibold text-zinc-900 dark:text-zinc-100 hover:bg-zinc-200/60 dark:hover:bg-zinc-800/70 transition-colors cursor-pointer whitespace-nowrap shrink-0"
      >
        <span dir="ltr">{currentModel.name}</span>
        <ChevronDown
          className={`w-4 h-4 text-zinc-400 transition-transform duration-150 ${
            isOpen ? 'rotate-180' : ''
          }`}
        />
      </button>

      {isOpen && (
        <div
          role="listbox"
          aria-label="فهرست مدل‌های هوش مصنوعی"
          className="absolute top-full right-0 mt-1.5 w-64 max-h-[72vh] overflow-y-auto rounded-2xl bg-white dark:bg-zinc-900 border border-zinc-200/90 dark:border-zinc-800 shadow-xl z-50 p-1.5"
        >
          <div className="space-y-0.5">
            {MODEL_OPTIONS.map((model) => {
              const active = model.id === selectedModel;
              return (
                <button
                  key={model.id}
                  type="button"
                  role="option"
                  aria-selected={active}
                  onClick={() => {
                    onSelectModel(model.id);
                    setOpen(false);
                  }}
                  className={`w-full px-3 py-2 rounded-xl flex items-center justify-between gap-2 transition-colors cursor-pointer ${
                    active
                      ? 'bg-zinc-100 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 font-semibold'
                      : 'hover:bg-zinc-100/70 dark:hover:bg-zinc-800/50 text-zinc-700 dark:text-zinc-300 font-medium'
                  }`}
                >
                  <div className="flex flex-col items-start min-w-0">
                    <span dir="ltr" className="text-sm whitespace-nowrap truncate">
                      {model.name}
                    </span>
                    <span className="text-[11px] text-zinc-400 dark:text-zinc-500">
                      {model.provider} · {model.badge}
                    </span>
                  </div>

                  {active && (
                    <Check className="w-4 h-4 text-zinc-900 dark:text-zinc-100 shrink-0" />
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
