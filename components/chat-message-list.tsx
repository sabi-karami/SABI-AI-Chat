'use client';

import React, { useState } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  Copy,
  Check,
  Download,
  FileText,
  Pencil,
  RotateCcw,
  Maximize2,
  Wand2,
  X,
} from 'lucide-react';
import { ConvertedWebPAttachment } from '@/lib/webp-converter';
import {
  MODEL_OPTIONS,
  ImageQualityTier,
  ImageAspectRatio,
  CouncilMode,
} from '@/lib/duck-protocol';
import { DotMatrixLoader } from '@/components/dot-matrix-loader';
import { LightboxImageItem } from '@/components/image-lightbox-modal';

export interface AttachedTextFile {
  id: string;
  name: string;
  content: string;
  sizeKB: number;
}

export interface GeneratedImageResult {
  b64: string;
  width?: number;
  height?: number;
  format: string;
  quality?: ImageQualityTier;
  aspectRatio?: ImageAspectRatio;
}

export interface CouncilMemberRun {
  id: string;
  name: string;
  provider: string;
  roleTitle: string;
  text: string;
  status: 'pending' | 'streaming' | 'done' | 'error';
}

export interface CouncilSessionData {
  mode: CouncilMode;
  stage: 'members' | 'judging' | 'done';
  members: CouncilMemberRun[];
}

export interface UIMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  model: string;
  timestamp: string;
  images?: ConvertedWebPAttachment[];
  files?: AttachedTextFile[];
  generatedImage?: GeneratedImageResult;
  statusTitle?: string;
  isStreaming?: boolean;
  isDrawRequest?: boolean;
  hasPartialImage?: boolean;
  imageGenPrompt?: string;
  imageQuality?: ImageQualityTier;
  imageAspectRatio?: ImageAspectRatio;
  councilData?: CouncilSessionData;
}

interface ChatMessageListProps {
  messages: UIMessage[];
  selectedModel: string;
  isStreaming?: boolean;
  onEditMessage?: (messageId: string, newText: string) => void;
  onRegenerateMessage?: (messageId: string) => void;
  onOpenImageLightbox?: (item: LightboxImageItem) => void;
}

function CodeBlock({
  language,
  code,
}: {
  language: string;
  code: string;
}) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div
      dir="ltr"
      className="my-4 rounded-2xl overflow-hidden border border-zinc-200 dark:border-zinc-800 bg-zinc-950 text-zinc-100 shadow-xs"
    >
      <div className="px-4 py-2 bg-zinc-900 border-b border-zinc-800 flex items-center justify-between text-xs text-zinc-400">
        <span className="font-mono lowercase">{language || 'code'}</span>
        <button
          type="button"
          onClick={handleCopy}
          aria-label="کپی کد"
          className="px-2.5 py-1 rounded-lg hover:bg-zinc-800 text-zinc-300 hover:text-white flex items-center gap-1.5 transition-colors cursor-pointer"
        >
          {copied ? (
            <>
              <Check className="w-3.5 h-3.5 text-emerald-400" />
              <span dir="rtl" className="font-sans text-[11px]">
                کپی شد
              </span>
            </>
          ) : (
            <>
              <Copy className="w-3.5 h-3.5" />
              <span dir="rtl" className="font-sans text-[11px]">
                کپی کد
              </span>
            </>
          )}
        </button>
      </div>
      <pre className="p-4 overflow-x-auto text-xs sm:text-[13px] font-mono leading-relaxed">
        <code>{code}</code>
      </pre>
    </div>
  );
}

export function ChatMessageList({
  messages,
  isStreaming = false,
  onEditMessage,
  onRegenerateMessage,
  onOpenImageLightbox,
}: ChatMessageListProps) {
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [activeBubbleId, setActiveBubbleId] = useState<string | null>(null);
  const [editingMsgId, setEditingMsgId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<string>('');
  const [selectedCouncilTabByMsg, setSelectedCouncilTabByMsg] = useState<
    Record<string, string>
  >({});

  const handleCopyText = (id: string, text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const handleStartEdit = (msg: UIMessage) => {
    setEditingMsgId(msg.id);
    setEditDraft(msg.text);
  };

  const handleSaveEdit = (msgId: string) => {
    const trimmed = editDraft.trim();
    if (!trimmed || !onEditMessage) return;
    setEditingMsgId(null);
    setActiveBubbleId(null);
    setEditDraft('');
    onEditMessage(msgId, trimmed);
  };

  const handleCancelEdit = () => {
    setEditingMsgId(null);
    setEditDraft('');
  };

  if (messages.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center px-4 py-8 max-w-2xl mx-auto w-full">
        <div className="sabi-hero" aria-label="SABI-AI">
          <div className="sabi-hero-aura" aria-hidden="true" />
          <div className="sabi-hero-orbit sabi-hero-orbit-one" aria-hidden="true"><i /></div>
          <div className="sabi-hero-orbit sabi-hero-orbit-two" aria-hidden="true"><i /></div>
          <span className="sabi-hero-spark sabi-hero-spark-one" aria-hidden="true">✦</span>
          <span className="sabi-hero-spark sabi-hero-spark-two" aria-hidden="true">✧</span>
          <div className="sabi-hero-word" dir="ltr" aria-hidden="true" data-text="SABI-AI">SABI-AI</div>
        </div>
        <h1
          style={{ textWrap: 'balance' }}
          className="text-2xl sm:text-3xl font-bold text-center text-zinc-900 dark:text-zinc-100"
        >
          چطور می‌توانم کمکتان کنم؟
        </h1>
      </div>
    );
  }

  return (
    <div className="flex-1 w-full max-w-3xl mx-auto px-4 py-6 space-y-6">
      {messages.map((msg) => {
        const modelDisplayName =
          MODEL_OPTIONS.find((m) => m.id === msg.model)?.name || msg.model;

        if (msg.role === 'user') {
          const isEditingThis = editingMsgId === msg.id;
          const isActionsOpen = activeBubbleId === msg.id;

          return (
            <div key={msg.id} className="flex flex-col items-start gap-1.5">
              <div
                onClick={() => {
                  if (!isEditingThis) {
                    setActiveBubbleId((prev) =>
                      prev === msg.id ? null : msg.id
                    );
                  }
                }}
                role={!isEditingThis ? 'button' : undefined}
                tabIndex={!isEditingThis ? 0 : undefined}
                onKeyDown={(e) => {
                  if (
                    !isEditingThis &&
                    (e.key === 'Enter' || e.key === ' ')
                  ) {
                    e.preventDefault();
                    setActiveBubbleId((prev) =>
                      prev === msg.id ? null : msg.id
                    );
                  }
                }}
                aria-label={!isEditingThis ? 'حباب پیام کاربر' : undefined}
                className={`${
                  isEditingThis
                    ? 'w-full sm:w-[82%]'
                    : 'max-w-[88%] sm:max-w-[78%] cursor-pointer hover:bg-zinc-200 dark:hover:bg-zinc-800 transition-colors'
                } rounded-3xl rounded-tr-md bg-zinc-200/80 dark:bg-zinc-800/90 text-zinc-900 dark:text-zinc-100 px-4 py-3 space-y-2.5 ${
                  isActionsOpen && !isEditingThis
                    ? 'ring-1 ring-zinc-300 dark:ring-zinc-700'
                    : ''
                }`}
              >
                {msg.images && msg.images.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {msg.images.map((img) => (
                      <div
                        key={img.id}
                        onClick={(e) => {
                          if (onOpenImageLightbox) {
                            e.stopPropagation();
                            onOpenImageLightbox({
                              dataUri: img.part.image,
                              downloadName: img.name || 'image.webp',
                              width: img.width,
                              height: img.height,
                            });
                          }
                        }}
                        className="rounded-2xl overflow-hidden border border-zinc-300/80 dark:border-zinc-700 max-w-[220px] cursor-zoom-in"
                      >
                        <img
                          src={img.part.image}
                          alt={img.name}
                          referrerPolicy="no-referrer"
                          className="w-full h-36 object-cover hover:opacity-95 transition-opacity"
                        />
                      </div>
                    ))}
                  </div>
                )}

                {msg.files && msg.files.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {msg.files.map((f) => (
                      <div
                        key={f.id}
                        className="px-3 py-1.5 rounded-xl bg-white/80 dark:bg-zinc-900/80 border border-zinc-300/80 dark:border-zinc-700 flex items-center gap-2 text-xs"
                      >
                        <FileText className="w-3.5 h-3.5 text-zinc-500 shrink-0" />
                        <span dir="ltr" className="truncate max-w-[160px]">
                          {f.name}
                        </span>
                      </div>
                    ))}
                  </div>
                )}

                {isEditingThis ? (
                  <div
                    className="space-y-2.5"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <textarea
                      value={editDraft}
                      onChange={(e) => setEditDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                          e.preventDefault();
                          handleSaveEdit(msg.id);
                        } else if (e.key === 'Escape') {
                          handleCancelEdit();
                        }
                      }}
                      rows={Math.min(6, Math.max(2, editDraft.split('\n').length))}
                      aria-label="متن ویرایش‌شده پیام"
                      autoFocus
                      className="w-full rounded-2xl px-3.5 py-2.5 text-[15px] leading-relaxed bg-white dark:bg-zinc-900 border border-zinc-300 dark:border-zinc-700 text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-1 focus:ring-amber-500 resize-none"
                    />
                    <div className="flex items-center justify-end gap-2">
                      <button
                        type="button"
                        onClick={handleCancelEdit}
                        className="px-3 py-1.5 rounded-xl text-xs font-medium text-zinc-600 dark:text-zinc-300 hover:bg-zinc-300/60 dark:hover:bg-zinc-700/60 flex items-center gap-1 transition-colors cursor-pointer"
                      >
                        <X className="w-3.5 h-3.5" />
                        <span>انصراف</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => handleSaveEdit(msg.id)}
                        disabled={!editDraft.trim() || isStreaming}
                        className="px-3.5 py-1.5 rounded-xl text-xs font-semibold bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-950 hover:opacity-90 disabled:opacity-40 flex items-center gap-1.5 transition-opacity cursor-pointer"
                      >
                        <Check className="w-3.5 h-3.5" />
                        <span>ذخیره و ارسال</span>
                      </button>
                    </div>
                  </div>
                ) : (
                  <p className="text-[15px] leading-relaxed whitespace-pre-wrap break-words">
                    {msg.text}
                  </p>
                )}
              </div>

              {!isEditingThis && isActionsOpen && (
                <div className="flex items-center gap-1 px-1 py-0.5 rounded-2xl bg-zinc-100/90 dark:bg-zinc-900/90 border border-zinc-200/80 dark:border-zinc-800/80 shadow-xs">
                  {onEditMessage && (
                    <button
                      type="button"
                      onClick={() => handleStartEdit(msg)}
                      disabled={isStreaming}
                      aria-label="ویرایش پیام"
                      title="ویرایش پیام"
                      className="min-h-[32px] px-2.5 py-1 rounded-xl text-xs text-zinc-600 dark:text-zinc-300 hover:text-zinc-950 dark:hover:text-white hover:bg-zinc-200/70 dark:hover:bg-zinc-800 disabled:opacity-40 flex items-center gap-1.5 transition-colors cursor-pointer"
                    >
                      <Pencil className="w-3.5 h-3.5" />
                      <span>ویرایش</span>
                    </button>
                  )}

                  {onRegenerateMessage && (
                    <button
                      type="button"
                      onClick={() => {
                        setActiveBubbleId(null);
                        onRegenerateMessage(msg.id);
                      }}
                      disabled={isStreaming}
                      aria-label="ارسال مجدد پیام"
                      title="ارسال مجدد پیام"
                      className="min-h-[32px] px-2.5 py-1 rounded-xl text-xs text-zinc-600 dark:text-zinc-300 hover:text-zinc-950 dark:hover:text-white hover:bg-zinc-200/70 dark:hover:bg-zinc-800 disabled:opacity-40 flex items-center gap-1.5 transition-colors cursor-pointer"
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                      <span>ارسال مجدد</span>
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={() => handleCopyText(msg.id, msg.text)}
                    aria-label="کپی پیام"
                    title="کپی پیام"
                    className="min-h-[32px] px-2.5 py-1 rounded-xl text-xs text-zinc-600 dark:text-zinc-300 hover:text-zinc-950 dark:hover:text-white hover:bg-zinc-200/70 dark:hover:bg-zinc-800 flex items-center gap-1.5 transition-colors cursor-pointer"
                  >
                    {copiedId === msg.id ? (
                      <>
                        <Check className="w-3.5 h-3.5 text-emerald-500" />
                        <span>کپی شد</span>
                      </>
                    ) : (
                      <>
                        <Copy className="w-3.5 h-3.5" />
                        <span>کپی</span>
                      </>
                    )}
                  </button>
                </div>
              )}
            </div>
          );
        }

        const imgMime =
          msg.generatedImage?.format === 'svg+xml'
            ? 'image/svg+xml'
            : msg.generatedImage?.format === 'png'
            ? 'image/png'
            : 'image/jpeg';
        const imgExt =
          msg.generatedImage?.format === 'svg+xml'
            ? 'svg'
            : msg.generatedImage?.format === 'png'
            ? 'png'
            : 'jpg';
        const imgDataUri = msg.generatedImage
          ? `data:${imgMime};base64,${msg.generatedImage.b64}`
          : null;

        const councilData = msg.councilData;
        const explicitTab = selectedCouncilTabByMsg[msg.id];
        const streamingMember = councilData?.members.find(
          (m) => m.status === 'streaming'
        );
        const activeCouncilTab =
          explicitTab ||
          (councilData && !msg.text && streamingMember
            ? streamingMember.id
            : 'verdict');

        const activeMemberObj =
          councilData && activeCouncilTab !== 'verdict'
            ? councilData.members.find((m) => m.id === activeCouncilTab)
            : null;

        const displayedMarkdownText = activeMemberObj
          ? activeMemberObj.text
          : msg.text;

        return (
          <div key={msg.id} className="w-full space-y-2.5">
            <div className="flex items-center gap-2 text-xs text-zinc-400 dark:text-zinc-500">
              {councilData ? (
                <span className="font-semibold text-zinc-800 dark:text-zinc-200">
                  شورای مدل‌ها (
                  {councilData.mode === 'debate'
                    ? 'مناظره و نقد'
                    : 'هم‌فکری ۳ هوش مصنوعی'}
                  )
                </span>
              ) : (
                <span
                  dir="ltr"
                  className="font-semibold text-zinc-700 dark:text-zinc-300"
                >
                  {modelDisplayName}
                </span>
              )}
              <span aria-hidden="true">·</span>
              <span className="tabular-nums">{msg.timestamp}</span>
            </div>

            {/* Minimalist Council Segmented Bar */}
            {councilData && (
              <div className="space-y-2">
                <div className="inline-flex flex-wrap items-center gap-1 p-1 rounded-2xl bg-zinc-100 dark:bg-zinc-900 border border-zinc-200/80 dark:border-zinc-800">
                  <button
                    type="button"
                    onClick={() =>
                      setSelectedCouncilTabByMsg((prev) => ({
                        ...prev,
                        [msg.id]: 'verdict',
                      }))
                    }
                    className={`px-3 py-1.5 rounded-xl text-xs font-medium flex items-center gap-1.5 transition-all cursor-pointer ${
                      activeCouncilTab === 'verdict'
                        ? 'bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 font-semibold shadow-2xs'
                        : 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100'
                    }`}
                  >
                    {councilData.stage === 'judging' && (
                      <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-ping" />
                    )}
                    <span>جمع‌بندی شورا</span>
                  </button>

                  {councilData.members.map((member) => {
                    const isTabActive = activeCouncilTab === member.id;
                    return (
                      <button
                        key={member.id}
                        type="button"
                        onClick={() =>
                          setSelectedCouncilTabByMsg((prev) => ({
                            ...prev,
                            [msg.id]: member.id,
                          }))
                        }
                        title={`${member.name} — ${member.roleTitle}`}
                        className={`px-3 py-1.5 rounded-xl text-xs font-medium flex items-center gap-1.5 transition-all cursor-pointer ${
                          isTabActive
                            ? 'bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 font-semibold shadow-2xs'
                            : 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100'
                        }`}
                      >
                        {member.status === 'streaming' ? (
                          <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-ping" />
                        ) : member.status === 'done' ? (
                          <Check className="w-3 h-3 text-emerald-500 shrink-0" />
                        ) : (
                          <span className="w-1.5 h-1.5 rounded-full bg-zinc-400/50" />
                        )}
                        <span dir="ltr">{member.name}</span>
                      </button>
                    );
                  })}
                </div>

                {activeMemberObj && (
                  <div className="flex items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400 px-1">
                    <span dir="ltr" className="font-semibold text-zinc-700 dark:text-zinc-300">
                      {activeMemberObj.name}
                    </span>
                    <span aria-hidden="true">·</span>
                    <span>{activeMemberObj.roleTitle}</span>
                  </div>
                )}
              </div>
            )}

            {msg.isStreaming && msg.isDrawRequest && !msg.generatedImage && (
              <DotMatrixLoader
                variant="sketching"
                statusTitle={msg.statusTitle || 'در حال طراحی تصویر...'}
                hasPartialProgress={msg.hasPartialImage}
                quality={msg.imageQuality}
                aspectRatio={msg.imageAspectRatio}
              />
            )}

            {msg.isStreaming &&
              !msg.isDrawRequest &&
              !displayedMarkdownText &&
              !msg.generatedImage && (
                <DotMatrixLoader
                  variant="thinking"
                  statusTitle={msg.statusTitle || 'در حال فکر کردن...'}
                />
              )}

            {imgDataUri && msg.generatedImage && (
              <div className="max-w-md rounded-2xl overflow-hidden border border-zinc-200 dark:border-zinc-800 bg-zinc-900">
                <div
                  role="button"
                  tabIndex={0}
                  aria-label="بزرگ‌نمایی و ویرایش تصویر"
                  onClick={() =>
                    onOpenImageLightbox?.({
                      dataUri: imgDataUri,
                      downloadName: `image_${msg.id}.${imgExt}`,
                      width: msg.generatedImage?.width || 1024,
                      height: msg.generatedImage?.height || 1024,
                      aspectRatio:
                        msg.generatedImage?.aspectRatio || msg.imageAspectRatio,
                    })
                  }
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      onOpenImageLightbox?.({
                        dataUri: imgDataUri,
                        downloadName: `image_${msg.id}.${imgExt}`,
                        width: msg.generatedImage?.width || 1024,
                        height: msg.generatedImage?.height || 1024,
                        aspectRatio:
                          msg.generatedImage?.aspectRatio || msg.imageAspectRatio,
                      });
                    }
                  }}
                  className="relative group cursor-zoom-in overflow-hidden"
                >
                  <img
                    src={imgDataUri}
                    alt={msg.text || 'تصویر تولید شده'}
                    referrerPolicy="no-referrer"
                    className="w-full h-auto object-cover transition-transform duration-200 group-hover:scale-[1.01]"
                  />
                  <div className="absolute top-3 left-3 opacity-0 group-hover:opacity-100 transition-opacity px-2.5 py-1.5 rounded-xl bg-black/70 backdrop-blur-xs text-white text-xs flex items-center gap-1.5 pointer-events-none">
                    <Maximize2 className="w-3.5 h-3.5" />
                    <span>بزرگ‌نمایی و ویرایش</span>
                  </div>
                </div>
                <div className="px-3.5 py-2.5 bg-zinc-100 dark:bg-zinc-900 border-t border-zinc-200 dark:border-zinc-800 flex items-center justify-between gap-2 text-xs">
                  <div dir="ltr" className="flex items-center gap-2 text-zinc-500 dark:text-zinc-400 tabular-nums">
                    <span>
                      {msg.generatedImage.width || 1024}×{msg.generatedImage.height || 1024}
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    {onOpenImageLightbox && (
                      <button
                        type="button"
                        onClick={() =>
                          onOpenImageLightbox({
                            dataUri: imgDataUri,
                            downloadName: `image_${msg.id}.${imgExt}`,
                            width: msg.generatedImage?.width || 1024,
                            height: msg.generatedImage?.height || 1024,
                            aspectRatio:
                              msg.generatedImage?.aspectRatio || msg.imageAspectRatio,
                          })
                        }
                        aria-label="ویرایش این تصویر"
                        className="px-2.5 py-1.5 rounded-xl bg-zinc-200/80 dark:bg-zinc-800 hover:bg-zinc-300/80 dark:hover:bg-zinc-700 text-zinc-800 dark:text-zinc-200 font-medium flex items-center gap-1.5 transition-colors cursor-pointer"
                      >
                        <Wand2 className="w-3.5 h-3.5 text-amber-500" />
                        <span>ویرایش تصویر</span>
                      </button>
                    )}
                    <a
                      href={imgDataUri}
                      download={`image_${msg.id}.${imgExt}`}
                      className="px-3 py-1.5 rounded-xl bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 font-medium flex items-center gap-1.5 transition-opacity hover:opacity-90"
                    >
                      <Download className="w-3.5 h-3.5" />
                      <span>دانلود تصویر</span>
                    </a>
                  </div>
                </div>
              </div>
            )}

            {displayedMarkdownText && (
              <div className="text-[15px] leading-7 text-zinc-800 dark:text-zinc-200 break-words">
                <Markdown
                  remarkPlugins={[remarkGfm]}
                  components={{
                    h1: ({ children }) => (
                      <h1 className="text-xl sm:text-2xl font-bold text-zinc-900 dark:text-zinc-100 mt-6 mb-3 pb-2 border-b border-zinc-200 dark:border-zinc-800 first:mt-0">
                        {children}
                      </h1>
                    ),
                    h2: ({ children }) => (
                      <h2 className="text-lg sm:text-xl font-bold text-zinc-900 dark:text-zinc-100 mt-5 mb-2.5 pb-1.5 border-b border-zinc-200/70 dark:border-zinc-800/70 first:mt-0">
                        {children}
                      </h2>
                    ),
                    h3: ({ children }) => (
                      <h3 className="text-base sm:text-lg font-bold text-zinc-900 dark:text-zinc-100 mt-4 mb-2 first:mt-0">
                        {children}
                      </h3>
                    ),
                    h4: ({ children }) => (
                      <h4 className="text-[15px] font-semibold text-zinc-900 dark:text-zinc-100 mt-3 mb-1.5 first:mt-0">
                        {children}
                      </h4>
                    ),
                    p: ({ children }) => (
                      <p className="mb-3 last:mb-0 leading-7">{children}</p>
                    ),
                    ul: ({ children }) => (
                      <ul className="my-3 pr-5 list-disc space-y-1.5 marker:text-zinc-400 dark:marker:text-zinc-500">
                        {children}
                      </ul>
                    ),
                    ol: ({ children }) => (
                      <ol className="my-3 pr-5 list-decimal space-y-1.5 marker:text-zinc-500 dark:marker:text-zinc-400 marker:font-medium">
                        {children}
                      </ol>
                    ),
                    li: ({ children }) => (
                      <li className="leading-7 pl-1">{children}</li>
                    ),
                    blockquote: ({ children }) => (
                      <blockquote className="my-3.5 pr-4 pl-3 py-2 border-r-2 border-zinc-400 dark:border-zinc-600 bg-zinc-100/80 dark:bg-zinc-900/70 rounded-l-xl text-zinc-700 dark:text-zinc-300 italic">
                        {children}
                      </blockquote>
                    ),
                    hr: () => (
                      <hr className="my-5 border-t border-zinc-200 dark:border-zinc-800" />
                    ),
                    strong: ({ children }) => (
                      <strong className="font-bold text-zinc-900 dark:text-zinc-100">
                        {children}
                      </strong>
                    ),
                    em: ({ children }) => <em className="italic">{children}</em>,
                    del: ({ children }) => (
                      <del className="line-through text-zinc-400 dark:text-zinc-500">
                        {children}
                      </del>
                    ),
                    a: ({ href, children }) => (
                      <a
                        href={href}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-emerald-600 dark:text-emerald-400 underline underline-offset-4 hover:opacity-80 font-medium"
                      >
                        {children}
                      </a>
                    ),
                    table: ({ children }) => (
                      <div className="my-4 overflow-x-auto rounded-2xl border border-zinc-200 dark:border-zinc-800">
                        <table className="w-full border-collapse text-sm">
                          {children}
                        </table>
                      </div>
                    ),
                    thead: ({ children }) => (
                      <thead className="bg-zinc-100 dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 border-b border-zinc-200 dark:border-zinc-800">
                        {children}
                      </thead>
                    ),
                    tbody: ({ children }) => (
                      <tbody className="divide-y divide-zinc-200/70 dark:divide-zinc-800/70">
                        {children}
                      </tbody>
                    ),
                    tr: ({ children }) => (
                      <tr className="hover:bg-zinc-100/50 dark:hover:bg-zinc-900/40 transition-colors">
                        {children}
                      </tr>
                    ),
                    th: ({ children }) => (
                      <th className="px-4 py-2.5 font-semibold text-right whitespace-nowrap">
                        {children}
                      </th>
                    ),
                    td: ({ children }) => (
                      <td className="px-4 py-2.5 text-zinc-700 dark:text-zinc-300 align-top">
                        {children}
                      </td>
                    ),
                    pre: ({ children }) => <>{children}</>,
                    code: ({ className, children, ...props }) => {
                      const match = /language-(\w+)/.exec(className || '');
                      const rawCode = String(children).replace(/\n$/, '');
                      const isBlock = Boolean(match) || rawCode.includes('\n');

                      if (isBlock) {
                        return (
                          <CodeBlock
                            language={match ? match[1] : ''}
                            code={rawCode}
                          />
                        );
                      }

                      return (
                        <code
                          dir="ltr"
                          className="px-1.5 py-0.5 mx-0.5 rounded-md bg-zinc-200/80 dark:bg-zinc-800 font-mono text-[13px] text-emerald-700 dark:text-emerald-300"
                          {...props}
                        >
                          {children}
                        </code>
                      );
                    },
                  }}
                >
                  {displayedMarkdownText}
                </Markdown>
              </div>
            )}

            {!msg.isStreaming && (displayedMarkdownText || msg.generatedImage) && (
              <div className="flex items-center gap-1.5 pt-0.5">
                {displayedMarkdownText && (
                  <button
                    type="button"
                    onClick={() => handleCopyText(msg.id, displayedMarkdownText)}
                    aria-label="کپی متن پاسخ"
                    className="min-h-[34px] px-2.5 py-1 rounded-xl text-xs text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-zinc-200/60 dark:hover:bg-zinc-800/60 flex items-center gap-1.5 transition-colors cursor-pointer"
                  >
                    {copiedId === msg.id ? (
                      <>
                        <Check className="w-3.5 h-3.5 text-emerald-500" />
                        <span>کپی شد</span>
                      </>
                    ) : (
                      <>
                        <Copy className="w-3.5 h-3.5" />
                        <span>کپی</span>
                      </>
                    )}
                  </button>
                )}

                {onRegenerateMessage && (
                  <button
                    type="button"
                    onClick={() => onRegenerateMessage(msg.id)}
                    disabled={isStreaming}
                    aria-label="تولید مجدد پاسخ"
                    title="دریافت مجدد پاسخ"
                    className="min-h-[34px] px-2.5 py-1 rounded-xl text-xs text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-zinc-200/60 dark:hover:bg-zinc-800/60 disabled:opacity-40 flex items-center gap-1.5 transition-colors cursor-pointer"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    <span>{msg.generatedImage ? 'طراحی مجدد' : 'پاسخ مجدد'}</span>
                  </button>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
