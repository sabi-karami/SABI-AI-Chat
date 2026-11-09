'use client';

import React, { useRef, useState } from 'react';
import {
  ArrowUp,
  Image as ImageIcon,
  Paperclip,
  Wand2,
  X,
  Square,
  FileText,
  Mic,
  Headphones,
  AudioLines,
  Loader2,
  Layers,
} from 'lucide-react';
import { ConvertedWebPAttachment } from '@/lib/webp-converter';
import { AttachedTextFile } from './chat-message-list';
import {
  ImageQualityTier,
  ImageAspectRatio,
  IMAGE_ASPECT_RATIO_OPTIONS,
  CouncilMode,
} from '@/lib/duck-protocol';
import { apiUrl } from '@/lib/base-path';

interface ChatComposerProps {
  prompt: string;
  onPromptChange: (val: string) => void;
  onSubmit: () => void;
  onStop?: () => void;
  isStreaming: boolean;
  drawMode: boolean;
  onToggleDrawMode: () => void;
  councilMode: boolean;
  onToggleCouncilMode: () => void;
  councilStrategy: CouncilMode;
  onSelectCouncilStrategy: (mode: CouncilMode) => void;
  imageQuality: ImageQualityTier;
  onSelectImageQuality: (q: ImageQualityTier) => void;
  imageAspectRatio: ImageAspectRatio;
  onSelectImageAspectRatio: (r: ImageAspectRatio) => void;
  pendingImages: ConvertedWebPAttachment[];
  onRemoveImage: (id: string) => void;
  onUploadImages: (files: FileList) => void;
  pendingFiles: AttachedTextFile[];
  onRemoveFile: (id: string) => void;
  onUploadTextFiles: (files: FileList) => void;
  errorBanner: string | null;
  onDismissError: () => void;
  selectedModel: string;
  onOpenLiveVoice: () => void;
}

export function ChatComposer({
  prompt,
  onPromptChange,
  onSubmit,
  onStop,
  isStreaming,
  drawMode,
  onToggleDrawMode,
  councilMode,
  onToggleCouncilMode,
  councilStrategy,
  onSelectCouncilStrategy,
  imageAspectRatio,
  onSelectImageAspectRatio,
  pendingImages,
  onRemoveImage,
  onUploadImages,
  pendingFiles,
  onRemoveFile,
  onUploadTextFiles,
  errorBanner,
  onDismissError,
  selectedModel,
  onOpenLiveVoice,
}: ChatComposerProps) {
  const imageInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [isRecordingDictation, setIsRecordingDictation] = useState<boolean>(false);
  const [isTranscribing, setIsTranscribing] = useState<boolean>(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);

  const newlineCount = (prompt.match(/\n/g) || []).length;
  const wrappedLineCount = prompt
    ? prompt
        .split('\n')
        .reduce((acc, line) => acc + Math.max(1, Math.ceil(line.length / 68)), 0)
    : 1;
  const totalLines = Math.max(newlineCount + 1, wrappedLineCount);
  // 1 base line + up to 6 Enters = maximum 7 visible rows
  const textareaRows = Math.min(7, Math.max(1, totalLines));
  const shouldScrollTextarea = totalLines > 7;

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      if (!isStreaming && (prompt.trim() || pendingImages.length > 0 || pendingFiles.length > 0)) {
        onSubmit();
      }
    }
  };

  const handleToggleDictation = async () => {
    if (isRecordingDictation) {
      // Stop recording
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
        mediaRecorderRef.current.stop();
      }
      setIsRecordingDictation(false);
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      recordedChunksRef.current = [];

      let recorder: MediaRecorder;
      try {
        recorder = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus' });
      } catch {
        recorder = new MediaRecorder(stream);
      }

      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          recordedChunksRef.current.push(e.data);
        }
      };

      recorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(recordedChunksRef.current, { type: 'audio/webm' });
        recordedChunksRef.current = [];

        if (blob.size < 100) return;

        setIsTranscribing(true);
        try {
          const res = await fetch(apiUrl('/api/duckvoice/dictation'), {
            method: 'POST',
            headers: { 'x-model': selectedModel },
            body: blob,
          });
          const data = await res.json();
          if (data.success && data.text) {
            onPromptChange(prompt ? `${prompt} ${data.text}` : data.text);
          }
        } catch {
          // ignore dictation error
        } finally {
          setIsTranscribing(false);
        }
      };

      recorder.start();
      setIsRecordingDictation(true);
    } catch {
      // mic access denied
    }
  };

  return (
    <div className="w-full max-w-3xl mx-auto px-3 sm:px-4 pb-4 pt-1">
      {errorBanner && (
        <div
          role="alert"
          className="mb-2.5 px-4 py-2.5 rounded-2xl bg-red-500/10 border border-red-500/30 text-red-600 dark:text-red-400 text-xs flex items-center justify-between gap-2"
        >
          <span>{errorBanner}</span>
          <button
            type="button"
            onClick={onDismissError}
            aria-label="بستن پیام خطا"
            className="p-1 rounded-lg hover:bg-red-500/20 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Sleek ChatGPT Floating Composer Card */}
      <div className="rounded-[28px] bg-white dark:bg-zinc-900 border border-zinc-200/90 dark:border-zinc-800 transition-colors shadow-sm">
        {/* Council Agent Strategy Bar when Council Mode is active */}
        {councilMode && !drawMode && (
          <div className="px-3.5 pt-3 pb-2 border-b border-zinc-100 dark:border-zinc-800/80 flex flex-wrap items-center justify-between gap-2 text-xs">
            <div className="flex items-center gap-2">
              <span className="text-[11px] text-zinc-500 dark:text-zinc-400 font-medium">
                شورای مدل‌ها:
              </span>
              <div className="inline-flex items-center p-0.5 rounded-xl bg-zinc-100 dark:bg-zinc-800/90 border border-zinc-200/70 dark:border-zinc-700/70">
                <button
                  type="button"
                  onClick={() => onSelectCouncilStrategy('synthesis')}
                  className={`px-2.5 py-1 rounded-lg text-[11px] font-medium transition-all cursor-pointer ${
                    councilStrategy === 'synthesis'
                      ? 'bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 font-semibold shadow-2xs'
                      : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100'
                  }`}
                >
                  هم‌فکری و ترکیب
                </button>
                <button
                  type="button"
                  onClick={() => onSelectCouncilStrategy('debate')}
                  className={`px-2.5 py-1 rounded-lg text-[11px] font-medium transition-all cursor-pointer ${
                    councilStrategy === 'debate'
                      ? 'bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 font-semibold shadow-2xs'
                      : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100'
                  }`}
                >
                  مناظره و نقد
                </button>
              </div>
            </div>

            <div
              dir="ltr"
              className="hidden sm:flex items-center gap-1.5 text-[11px] text-zinc-400 dark:text-zinc-500"
            >
              <span>GPT-6 Luna</span>
              <span aria-hidden="true">·</span>
              <span>Claude 5.5</span>
              <span aria-hidden="true">·</span>
              <span>Gemma 4</span>
            </div>
          </div>
        )}

        {/* Aspect Ratio Controls when Draw Mode is active */}
        {drawMode && (
          <div className="px-3.5 pt-3 pb-2 border-b border-zinc-100 dark:border-zinc-800/80 flex items-center justify-between gap-2 text-xs">
            <div className="flex items-center gap-1.5">
              <span className="text-[11px] text-zinc-400 dark:text-zinc-500 font-medium">
                ابعاد تصویر:
              </span>
              <div
                dir="ltr"
                className="inline-flex items-center p-0.5 rounded-xl bg-zinc-100 dark:bg-zinc-800/90 border border-zinc-200/70 dark:border-zinc-700/70"
              >
                {IMAGE_ASPECT_RATIO_OPTIONS.map((r) => {
                  const active = imageAspectRatio === r.id;
                  return (
                    <button
                      key={r.id}
                      type="button"
                      onClick={() => onSelectImageAspectRatio(r.id)}
                      title={r.title}
                      aria-label={`نسبت تصویر ${r.label}`}
                      className={`px-2.5 py-1 rounded-lg text-[11px] font-medium tabular-nums transition-all cursor-pointer ${
                        active
                          ? 'bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 font-semibold shadow-2xs'
                          : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100'
                      }`}
                    >
                      {r.label}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {/* Pending Attachments Preview */}
        {(pendingImages.length > 0 || pendingFiles.length > 0) && (
          <div className="px-4 pt-3.5 pb-1.5 flex flex-wrap gap-2 border-b border-zinc-100 dark:border-zinc-800/70">
            {pendingImages.map((img) => (
              <div
                key={img.id}
                className="relative flex items-center gap-2 p-1.5 pr-2.5 rounded-2xl bg-zinc-100 dark:bg-zinc-800/90 border border-zinc-200/80 dark:border-zinc-700"
              >
                <img
                  src={img.part.image}
                  alt={img.name}
                  referrerPolicy="no-referrer"
                  className="w-10 h-10 rounded-xl object-cover shrink-0"
                />
                <span className="text-xs font-medium text-zinc-800 dark:text-zinc-200 truncate max-w-[110px]">
                  {img.name}
                </span>
                <button
                  type="button"
                  onClick={() => onRemoveImage(img.id)}
                  aria-label={`حذف تصویر ${img.name}`}
                  className="min-h-[28px] min-w-[28px] rounded-xl flex items-center justify-center text-zinc-400 hover:text-red-500 transition-colors cursor-pointer"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}

            {pendingFiles.map((f) => (
              <div
                key={f.id}
                className="flex items-center gap-2 px-3 py-1.5 rounded-2xl bg-zinc-100 dark:bg-zinc-800/90 border border-zinc-200/80 dark:border-zinc-700 text-xs"
              >
                <FileText className="w-3.5 h-3.5 text-zinc-500 shrink-0" />
                <span dir="ltr" className="font-medium text-zinc-800 dark:text-zinc-200 truncate max-w-[130px]">
                  {f.name}
                </span>
                <button
                  type="button"
                  onClick={() => onRemoveFile(f.id)}
                  aria-label={`حذف فایل ${f.name}`}
                  className="min-h-[28px] min-w-[28px] rounded-lg flex items-center justify-center text-zinc-400 hover:text-red-500 cursor-pointer"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Textarea Input */}
        <div className="px-4 pt-3.5 pb-1">
          <label htmlFor="chat-prompt-textarea" className="sr-only">
            متن پیام
          </label>
          <textarea
            id="chat-prompt-textarea"
            rows={textareaRows}
            value={prompt}
            onChange={(e) => onPromptChange(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={
              isRecordingDictation
                ? 'در حال گوش دادن... (برای پایان دوباره روی میکروفون بزنید)'
                : isTranscribing
                ? 'در حال تبدیل صدا به متن...'
                : drawMode
                ? 'تصویری که می‌خواهید طراحی شود را توصیف کنید...'
                : councilMode
                ? 'موضوع یا سوال خود را برای بررسی همزمان در شورای مدل‌ها بنویسید...'
                : 'پیام خود را بنویسید...'
            }
            className={`w-full resize-none bg-transparent text-[15px] text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 dark:placeholder:text-zinc-500 focus:outline-none leading-6 min-h-[28px] max-h-[168px] ${
              shouldScrollTextarea ? 'overflow-y-auto' : 'overflow-y-hidden'
            }`}
          />
        </div>

        {/* Bottom Action Toolbar: Primary Action (Live Voice / Send) + Mic on Right, Attachments on Left */}
        <div className="px-3 pb-2.5 pt-1 flex items-center justify-between gap-2">
          {/* Right side in RTL: Morphing Primary Button (Live Voice when empty -> Send when typing) + Dictation Mic */}
          <div className="flex items-center gap-1.5 shrink-0">
            {isStreaming ? (
              <button
                type="button"
                onClick={onStop}
                aria-label="توقف دریافت پاسخ"
                title="توقف دریافت پاسخ"
                className="min-h-[44px] min-w-[44px] rounded-full bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 flex items-center justify-center hover:opacity-90 transition-all cursor-pointer"
              >
                <Square className="w-4 h-4 fill-current" />
              </button>
            ) : prompt.trim().length > 0 ||
              pendingImages.length > 0 ||
              pendingFiles.length > 0 ? (
              <button
                type="button"
                onClick={onSubmit}
                aria-label="ارسال پیام"
                title="ارسال پیام"
                className="min-h-[44px] min-w-[44px] rounded-full bg-zinc-900 dark:bg-zinc-100 hover:opacity-90 text-white dark:text-zinc-900 flex items-center justify-center transition-all cursor-pointer shadow-xs"
              >
                <ArrowUp className="w-5 h-5" />
              </button>
            ) : (
              <button
                type="button"
                onClick={onOpenLiveVoice}
                aria-label="گفتگوی زنده صوتی"
                title="گفتگوی زنده صوتی با هوش مصنوعی"
                className="min-h-[44px] min-w-[44px] rounded-full bg-zinc-900 dark:bg-zinc-100 hover:opacity-90 text-white dark:text-zinc-900 flex items-center justify-center transition-all cursor-pointer shadow-xs"
              >
                <AudioLines className="w-5 h-5" />
              </button>
            )}

            {/* Dictation Mic Button */}
            <button
              type="button"
              onClick={handleToggleDictation}
              disabled={isStreaming || isTranscribing}
              aria-label={isRecordingDictation ? 'توقف ضبط صدا' : 'تبدیل گفتار به متن'}
              title={isRecordingDictation ? 'توقف ضبط صدا' : 'ویس به متن (دیکته صوتی)'}
              className={`min-h-[44px] min-w-[44px] rounded-full flex items-center justify-center transition-colors cursor-pointer ${
                isRecordingDictation
                  ? 'bg-red-500 text-white animate-pulse'
                  : isTranscribing
                  ? 'bg-amber-500/20 text-amber-500'
                  : 'text-zinc-500 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 hover:text-zinc-900 dark:hover:text-zinc-100'
              }`}
            >
              {isTranscribing ? (
                <Loader2 className="w-5 h-5 animate-spin" />
              ) : (
                <Mic className="w-5 h-5" />
              )}
            </button>
          </div>

          {/* Left side in RTL: Icon-Only Action Buttons */}
          <div className="flex items-center gap-1">
            <input
              ref={imageInputRef}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={(e) => {
                if (e.target.files && e.target.files.length > 0) {
                  onUploadImages(e.target.files);
                  e.target.value = '';
                }
              }}
            />
            <input
              ref={fileInputRef}
              type="file"
              multiple
              className="hidden"
              onChange={(e) => {
                if (e.target.files && e.target.files.length > 0) {
                  onUploadTextFiles(e.target.files);
                  e.target.value = '';
                }
              }}
            />

            {/* Toggle Council Agent Mode (Icon Only, turns amber/active like Draw Mode) */}
            <button
              type="button"
              onClick={onToggleCouncilMode}
              aria-pressed={councilMode}
              aria-label="شورای مدل‌ها"
              title="ایجنت شورای مدل‌ها (هم‌فکری ۳ هوش مصنوعی)"
              className={`min-h-[44px] min-w-[44px] flex items-center justify-center transition-colors cursor-pointer ${
                councilMode
                  ? 'text-amber-500'
                  : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100'
              }`}
            >
              <Layers className={`w-5 h-5 ${councilMode ? 'text-amber-500' : ''}`} />
            </button>

            {/* Toggle Draw Mode (Icon Only, turns orange without circle) */}
            <button
              type="button"
              onClick={onToggleDrawMode}
              aria-pressed={drawMode}
              aria-label="ساخت تصویر"
              title="ساخت تصویر"
              className={`min-h-[44px] min-w-[44px] flex items-center justify-center transition-colors cursor-pointer ${
                drawMode
                  ? 'text-amber-500'
                  : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100'
              }`}
            >
              <Wand2 className={`w-5 h-5 ${drawMode ? 'text-amber-500' : ''}`} />
            </button>

            {/* Attach File (Icon Only) */}
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              aria-label="پیوست فایل"
              title="پیوست فایل"
              className="min-h-[44px] min-w-[44px] rounded-full text-zinc-500 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 hover:text-zinc-900 dark:hover:text-zinc-100 flex items-center justify-center transition-colors cursor-pointer"
            >
              <Paperclip className="w-5 h-5" />
            </button>

            {/* Upload Image (Icon Only) */}
            <button
              type="button"
              onClick={() => imageInputRef.current?.click()}
              aria-label="افزودن تصویر"
              title="افزودن تصویر"
              className="min-h-[44px] min-w-[44px] rounded-full text-zinc-500 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 hover:text-zinc-900 dark:hover:text-zinc-100 flex items-center justify-center transition-colors cursor-pointer"
            >
              <ImageIcon className="w-5 h-5" />
            </button>
          </div>
        </div>
      </div>
      <div className="sabi-credit" dir="rtl" aria-label="خلق شده با عشق توسط صاحب کرمی">
        <span>خلق شده با</span>
        <span className="sabi-credit-heart" aria-hidden="true">♥</span>
        <span>توسط</span>
        <span className="sabi-credit-signature">صاحب کرمی</span>
      </div>
    </div>
  );
}
