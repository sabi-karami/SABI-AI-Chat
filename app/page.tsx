'use client';

import React, { useState, useRef, useEffect } from 'react';
import { Menu, Plus } from 'lucide-react';
import {
  resolveModel,
  formatFileToPromptChunk,
  parseSlashCommand,
  isImageGenerationPrompt,
  rebuildHistoryFromMessages,
  extractImageGenPrompt,
  MODEL_OPTIONS,
  COUNCIL_DEFAULT_MEMBERS,
  CouncilMode,
  DuckHistoryMessage,
  ImageQualityTier,
  ImageAspectRatio,
} from '@/lib/duck-protocol';
import {
  convertFileToWebP,
  convertDataUrlToWebP,
  ConvertedWebPAttachment,
} from '@/lib/webp-converter';
import { ModelSwitcher } from '@/components/model-switcher';
import { ChatSidebar, ChatSessionItem } from '@/components/chat-sidebar';
import {
  ChatMessageList,
  UIMessage,
  AttachedTextFile,
  CouncilMemberRun,
} from '@/components/chat-message-list';
import { ChatComposer } from '@/components/chat-composer';
import { WelcomeCelebration } from '@/components/welcome-celebration';
import {
  ImageLightboxModal,
  LightboxImageItem,
} from '@/components/image-lightbox-modal';
import {
  LiveVoiceModal,
  LiveVoiceTurn,
} from '@/components/live-voice-modal';
import { apiUrl } from '@/lib/base-path';

interface ConversationRecord {
  id: string;
  title: string;
  model: string;
  updatedAt: number;
  messages: UIMessage[];
  history: DuckHistoryMessage[];
}

const STORAGE_KEY = 'duckai_conversations_v1';

const HELP_TEXT = `### راهنمای دستورات سریع

- **\`/council <سوال>\`**: اجرای ایجنت شورای مدل‌ها (بررسی همزمان توسط ۳ مدل + جمع‌بندی داور)
- **\`/live\`**: شروع گفتگوی زنده صوتی (پخش زنده و تماس صوتی دوطرفه)
- **\`/mic\`**: ضبط ویس و تبدیل فوری گفتار به متن
- **\`/draw <توضیح>\`**: طراحی و تولید تصویر بر اساس متن شما
- **\`/model [نام مدل]\`**: تغییر سریع مدل هوش مصنوعی (\`luna\`, \`mini\`, \`nano\`, \`haiku-5.5\`, \`gemma\`, \`gpt-oss\`, \`mistral\`)
- **\`/clear\`**: پاک‌کردن گفتگوی فعلی و شروع صفحه جدید`;

export default function DuckAIChatApp() {
  const [selectedModel, setSelectedModel] = useState<string>('gpt-6-luna');
  const [conversations, setConversations] = useState<ConversationRecord[]>([
    {
      id: 'default-session',
      title: 'گفتگوی جدید',
      model: 'gpt-6-luna',
      updatedAt: Date.now(),
      messages: [],
      history: [],
    },
  ]);
  const [activeSessionId, setActiveSessionId] = useState<string>('default-session');
  const [hydrated, setHydrated] = useState<boolean>(false);

  const [celebrationKey, setCelebrationKey] = useState(0);

  const [prompt, setPrompt] = useState<string>('');
  const [drawMode, setDrawMode] = useState<boolean>(false);
  const [councilMode, setCouncilMode] = useState<boolean>(false);
  const [councilStrategy, setCouncilStrategy] = useState<CouncilMode>('synthesis');
  const [imageQuality, setImageQuality] = useState<ImageQualityTier>('1K');
  const [imageAspectRatio, setImageAspectRatio] = useState<ImageAspectRatio>('1:1');
  const [pendingImages, setPendingImages] = useState<ConvertedWebPAttachment[]>([]);
  const [pendingFiles, setPendingFiles] = useState<AttachedTextFile[]>([]);
  const [isStreaming, setIsStreaming] = useState<boolean>(false);
  const [errorBanner, setErrorBanner] = useState<string | null>(null);

  const [mobileSidebarOpen, setMobileSidebarOpen] = useState<boolean>(false);
  const [modelPickerOpen, setModelPickerOpen] = useState<boolean>(false);
  const [isDark, setIsDark] = useState<boolean>(true);
  const [lightboxItem, setLightboxItem] = useState<LightboxImageItem | null>(null);
  const [isLiveVoiceOpen, setIsLiveVoiceOpen] = useState<boolean>(false);

  const abortControllerRef = useRef<AbortController | null>(null);
  const feedEndRef = useRef<HTMLDivElement>(null);

  const handleAddVoiceTranscriptToChat = (turns: LiveVoiceTurn[]) => {
    if (!turns || turns.length === 0) return;
    const nowTime = new Date().toLocaleTimeString('fa-IR', {
      hour: '2-digit',
      minute: '2-digit',
    });
    const newUiMessages: UIMessage[] = turns.map((t, idx) => ({
      id: `voice-${Date.now()}-${idx}`,
      role: t.role,
      text: t.text,
      model: selectedModel,
      timestamp: t.timestamp || nowTime,
    }));

    updateActiveSession((prev) => {
      const priorHistory = prev.history;
      const additionalHistory: DuckHistoryMessage[] = turns.map((t) => ({
        role: t.role,
        content: t.text,
      }));
      return {
        ...prev,
        title:
          prev.messages.length === 0 && turns[0]?.text
            ? `تماس صوتی: ${turns[0].text.slice(0, 24)}...`
            : prev.title,
        updatedAt: Date.now(),
        messages: [...prev.messages, ...newUiMessages],
        history: [...priorHistory, ...additionalHistory],
      };
    });
  };

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed.conversations) && parsed.conversations.length > 0) {
          setConversations(parsed.conversations);
          setActiveSessionId(
            parsed.activeSessionId || parsed.conversations[0].id
          );
        }
      }
    } catch {
      // Ignore storage read errors
    } finally {
      setHydrated(true);
    }
  }, []);

  useEffect(() => {
    if (!hydrated || isStreaming) return;
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          conversations,
          activeSessionId,
        })
      );
    } catch {
      // If quota exceeded due to large base64 images, store without heavy generatedImage blobs
      try {
        const lightConversations = conversations.map((c) => ({
          ...c,
          messages: c.messages.map((m) => ({
            ...m,
            generatedImage: undefined,
          })),
        }));
        localStorage.setItem(
          STORAGE_KEY,
          JSON.stringify({
            conversations: lightConversations,
            activeSessionId,
          })
        );
      } catch {
        // Ignore storage write errors
      }
    }
  }, [conversations, activeSessionId, hydrated, isStreaming]);

  const activeSession =
    conversations.find((c) => c.id === activeSessionId) || conversations[0];

  useEffect(() => {
    feedEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [activeSession.messages.length, isStreaming]);

  const handleToggleTheme = () => {
    const nextDark = !isDark;
    setIsDark(nextDark);
    if (typeof document !== 'undefined') {
      document.documentElement.classList.toggle('dark', nextDark);
    }
  };

  const updateActiveSession = (
    updater: (prev: ConversationRecord) => ConversationRecord
  ) => {
    setConversations((prev) =>
      prev.map((item) => (item.id === activeSession.id ? updater(item) : item))
    );
  };

  const handleNewChat = () => {
    setCelebrationKey((previous) => previous + 1);
    if (isStreaming) {
      abortControllerRef.current?.abort();
    }
    const newId = `session-${Date.now()}`;
    const newConv: ConversationRecord = {
      id: newId,
      title: 'گفتگوی جدید',
      model: selectedModel,
      updatedAt: Date.now(),
      messages: [],
      history: [],
    };
    setConversations((prev) => [newConv, ...prev]);
    setActiveSessionId(newId);
    setPrompt('');
    setPendingImages([]);
    setPendingFiles([]);
    setDrawMode(false);
    setErrorBanner(null);
  };

  const handleRenameSession = (id: string, newTitle: string) => {
    const trimmed = newTitle.trim();
    if (!trimmed) return;
    setConversations((prev) =>
      prev.map((c) =>
        c.id === id ? { ...c, title: trimmed, updatedAt: Date.now() } : c
      )
    );
  };

  const handleDeleteSession = (id: string) => {
    if (id === activeSession.id && isStreaming) {
      abortControllerRef.current?.abort();
    }
    setConversations((prev) => {
      const filtered = prev.filter((c) => c.id !== id);
      if (filtered.length === 0) {
        const freshId = `session-${Date.now()}`;
        setActiveSessionId(freshId);
        return [
          {
            id: freshId,
            title: 'گفتگوی جدید',
            model: selectedModel,
            updatedAt: Date.now(),
            messages: [],
            history: [],
          },
        ];
      }
      if (id === activeSessionId) {
        setActiveSessionId(filtered[0].id);
      }
      return filtered;
    });
  };

  const handleClearAllSessions = () => {
    if (isStreaming) {
      abortControllerRef.current?.abort();
    }
    const freshId = `session-${Date.now()}`;
    setConversations([
      {
        id: freshId,
        title: 'گفتگوی جدید',
        model: selectedModel,
        updatedAt: Date.now(),
        messages: [],
        history: [],
      },
    ]);
    setActiveSessionId(freshId);
  };

  const handleUploadImages = async (fileList: FileList) => {
    setErrorBanner(null);
    const filesArray = Array.from(fileList);
    for (const file of filesArray) {
      try {
        const converted = await convertFileToWebP(file);
        setPendingImages((prev) => [...prev, converted]);
      } catch (err: any) {
        setErrorBanner(err?.message || 'خطا در پردازش تصویر');
      }
    }
  };

  const handleUploadTextFiles = async (fileList: FileList) => {
    setErrorBanner(null);
    const filesArray = Array.from(fileList);
    for (const file of filesArray) {
      const lowerName = file.name.toLowerCase();
      const isImageFile =
        file.type.startsWith('image/') ||
        /\.(jpg|jpeg|png|webp|gif|bmp|svg)$/i.test(lowerName);

      if (isImageFile) {
        try {
          const converted = await convertFileToWebP(file);
          setPendingImages((prev) => [...prev, converted]);
        } catch (err: any) {
          setErrorBanner(err?.message || 'خطا در پردازش تصویر');
        }
        continue;
      }

      try {
        const textContent = await file.text();
        if (!textContent.trim()) {
          setErrorBanner(`فایل «${file.name}» خالی است.`);
          continue;
        }
        setPendingFiles((prev) => [
          ...prev,
          {
            id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
            name: file.name,
            content: textContent,
            sizeKB: Math.max(1, Math.round(file.size / 1024)),
          },
        ]);
      } catch {
        setErrorBanner(`خواندن فایل ناموفق بود: ${file.name}`);
      }
    }
  };

  const executeChatTurn = async (opts: {
    userPrompt: string;
    isDraw: boolean;
    qualityToUse?: ImageQualityTier;
    aspectRatioToUse?: ImageAspectRatio;
    imagesToUse: ConvertedWebPAttachment[];
    filesToUse: AttachedTextFile[];
    modelToUse: string;
    baseMessagesOverride?: UIMessage[];
    baseHistoryOverride?: DuckHistoryMessage[];
  }) => {
    const {
      userPrompt,
      isDraw,
      qualityToUse = imageQuality,
      aspectRatioToUse = imageAspectRatio,
      imagesToUse,
      filesToUse,
      modelToUse,
      baseMessagesOverride,
      baseHistoryOverride,
    } = opts;
    const nowTime = new Date().toLocaleTimeString('fa-IR', {
      hour: '2-digit',
      minute: '2-digit',
    });

    const userMsgId = `u-${Date.now()}`;
    const assistantMsgId = `a-${Date.now() + 1}`;

    const userMessage: UIMessage = {
      id: userMsgId,
      role: 'user',
      text: userPrompt,
      model: modelToUse,
      timestamp: nowTime,
      images: imagesToUse,
      files: filesToUse,
      isDrawRequest: isDraw,
      imageQuality: isDraw ? qualityToUse : undefined,
      imageAspectRatio: isDraw ? aspectRatioToUse : undefined,
    };

    const initialAssistantMessage: UIMessage = {
      id: assistantMsgId,
      role: 'assistant',
      text: '',
      model: modelToUse,
      timestamp: nowTime,
      statusTitle: isDraw ? 'در حال طراحی تصویر...' : 'در حال فکر کردن...',
      isStreaming: true,
      isDrawRequest: isDraw,
      imageQuality: isDraw ? qualityToUse : undefined,
      imageAspectRatio: isDraw ? aspectRatioToUse : undefined,
    };

    const currentHistory = baseHistoryOverride ?? activeSession.history;

    updateActiveSession((prev) => {
      const priorMsgs = baseMessagesOverride ?? prev.messages;
      const shouldSetDefaultTitle =
        priorMsgs.length === 0 && prev.title === 'گفتگوی جدید';

      return {
        ...prev,
        title: shouldSetDefaultTitle
          ? userPrompt.slice(0, 38) || 'گفتگوی جدید'
          : prev.title,
        model: modelToUse,
        updatedAt: Date.now(),
        history: currentHistory,
        messages: [...priorMsgs, userMessage, initialAssistantMessage],
      };
    });

    setIsStreaming(true);
    setErrorBanner(null);

    let promptExtra = '';
    for (const f of filesToUse) {
      promptExtra += formatFileToPromptChunk(f.name, f.content);
    }

    const controller = new AbortController();
    abortControllerRef.current = controller;

    let accumulatedText = '';
    let generatedImg: UIMessage['generatedImage'] = undefined;

    try {
      const res = await fetch(apiUrl('/api/duckchat'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: userPrompt,
          model: modelToUse,
          history: currentHistory,
          images: imagesToUse.map((i) => i.part),
          draw: isDraw,
          imageQuality: qualityToUse,
          imageAspectRatio: aspectRatioToUse,
          promptExtra,
        }),
        signal: controller.signal,
      });

      if (!res.ok || !res.body) {
        throw new Error(`خطا در ارتباط با سرور (${res.status})`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.trim()) continue;
          let ev: any;
          try {
            ev = JSON.parse(line);
          } catch {
            continue;
          }

          if (ev.kind === 'message') {
            accumulatedText += ev.value;
            updateActiveSession((prev) => ({
              ...prev,
              messages: prev.messages.map((m) =>
                m.id === assistantMsgId
                  ? {
                      ...m,
                      text: accumulatedText,
                      statusTitle:
                        m.isDrawRequest && !m.generatedImage
                          ? m.statusTitle || 'در حال طراحی تصویر...'
                          : undefined,
                    }
                  : m
              ),
            }));
          } else if (ev.kind === 'image_title') {
            updateActiveSession((prev) => ({
              ...prev,
              messages: prev.messages.map((m) =>
                m.id === assistantMsgId
                  ? {
                      ...m,
                      isDrawRequest: true,
                      statusTitle: ev.value || m.statusTitle || 'در حال طراحی تصویر...',
                    }
                  : m
              ),
            }));
          } else if (ev.kind === 'image_partial') {
            updateActiveSession((prev) => ({
              ...prev,
              messages: prev.messages.map((m) =>
                m.id === assistantMsgId
                  ? {
                      ...m,
                      isDrawRequest: true,
                      hasPartialImage: true,
                      statusTitle: m.statusTitle || 'در حال طراحی تصویر...',
                    }
                  : m
              ),
            }));
          } else if (ev.kind === 'tool') {
            if (ev.value?.toolName === 'GenerateImage') {
              updateActiveSession((prev) => ({
                ...prev,
                messages: prev.messages.map((m) =>
                  m.id === assistantMsgId
                    ? {
                        ...m,
                        isDrawRequest: true,
                        statusTitle: m.statusTitle || 'در حال طراحی تصویر...',
                      }
                    : m
                ),
              }));
            }
          } else if (ev.kind === 'image') {
            generatedImg = ev.value;
            updateActiveSession((prev) => ({
              ...prev,
              messages: prev.messages.map((m) =>
                m.id === assistantMsgId
                  ? { ...m, generatedImage: generatedImg, statusTitle: undefined }
                  : m
              ),
            }));
          } else if (ev.kind === 'error') {
            throw new Error(ev.value);
          }
        }
      }

      updateActiveSession((prev) => {
        const userHistoryContent: any[] = [
          { type: 'text', text: userPrompt + promptExtra },
          ...imagesToUse.map((img) => img.part),
        ];

        const nextHistory: DuckHistoryMessage[] = [
          ...prev.history,
          { role: 'user', content: userHistoryContent },
        ];

        if (isDraw && generatedImg) {
          nextHistory.push({
            role: 'assistant',
            content: '',
            parts: [
              {
                type: 'generated-image',
                result: generatedImg.b64,
                width: generatedImg.width,
                height: generatedImg.height,
                format: generatedImg.format,
              },
              { type: 'text', text: accumulatedText || '' },
            ],
          });
        } else {
          nextHistory.push({
            role: 'assistant',
            content: accumulatedText,
          });
        }

        return {
          ...prev,
          history: nextHistory,
          messages: prev.messages.map((m) =>
            m.id === assistantMsgId
              ? { ...m, isStreaming: false, statusTitle: undefined }
              : m
          ),
        };
      });
    } catch (err: any) {
      if (err?.name !== 'AbortError') {
        setErrorBanner(err?.message || 'خطا در دریافت پاسخ');
      }
      updateActiveSession((prev) => ({
        ...prev,
        messages: prev.messages.map((m) =>
          m.id === assistantMsgId
            ? {
                ...m,
                text: m.text || 'پاسخ متوقف شد.',
                isStreaming: false,
                statusTitle: undefined,
              }
            : m
        ),
      }));
    } finally {
      setIsStreaming(false);
      abortControllerRef.current = null;
    }
  };

  const executeCouncilTurn = async ({
    userPrompt,
    strategyToUse,
    filesToUse,
    baseMessagesOverride,
    baseHistoryOverride,
  }: {
    userPrompt: string;
    strategyToUse: CouncilMode;
    filesToUse: AttachedTextFile[];
    baseMessagesOverride?: UIMessage[];
    baseHistoryOverride?: DuckHistoryMessage[];
  }) => {
    const nowTime = new Date().toLocaleTimeString('fa-IR', {
      hour: '2-digit',
      minute: '2-digit',
    });

    const userMsgId = `u-${Date.now()}`;
    const assistantMsgId = `a-${Date.now() + 1}`;

    const initialMembers: CouncilMemberRun[] = COUNCIL_DEFAULT_MEMBERS.map((spec) => ({
      id: spec.id,
      name: spec.name,
      provider: spec.provider,
      roleTitle:
        strategyToUse === 'debate'
          ? spec.roleTitleDebate
          : spec.roleTitleSynthesis,
      text: '',
      status: 'pending',
    }));

    const userMessage: UIMessage = {
      id: userMsgId,
      role: 'user',
      text: userPrompt,
      model: 'gpt-6-luna',
      files: filesToUse,
      timestamp: nowTime,
    };

    const initialAssistantMessage: UIMessage = {
      id: assistantMsgId,
      role: 'assistant',
      text: '',
      model: 'gpt-6-luna',
      isStreaming: true,
      timestamp: nowTime,
      councilData: {
        mode: strategyToUse,
        stage: 'members',
        members: initialMembers,
      },
    };

    const currentHistory = baseHistoryOverride ?? activeSession.history;

    updateActiveSession((prev) => {
      const priorMsgs = baseMessagesOverride ?? prev.messages;
      const shouldSetDefaultTitle =
        priorMsgs.length === 0 && prev.title === 'گفتگوی جدید';

      return {
        ...prev,
        title: shouldSetDefaultTitle
          ? userPrompt.slice(0, 38) || 'گفتگوی جدید'
          : prev.title,
        updatedAt: Date.now(),
        history: currentHistory,
        messages: [...priorMsgs, userMessage, initialAssistantMessage],
      };
    });

    setIsStreaming(true);
    setErrorBanner(null);

    let promptExtra = '';
    for (const f of filesToUse) {
      promptExtra += formatFileToPromptChunk(f.name, f.content);
    }

    const controller = new AbortController();
    abortControllerRef.current = controller;

    const streamSingleModel = async (
      modelId: string,
      promptText: string,
      onToken: (fullText: string) => void
    ): Promise<string> => {
      const res = await fetch(apiUrl('/api/duckchat'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: promptText,
          model: modelId,
          history: currentHistory,
          images: [],
          draw: false,
          promptExtra,
        }),
        signal: controller.signal,
      });

      if (!res.ok || !res.body) {
        throw new Error(`خطا در ارتباط با مدل ${modelId} (${res.status})`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let acc = '';

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.trim()) continue;
          let ev: any;
          try {
            ev = JSON.parse(line);
          } catch {
            continue;
          }
          if (ev.kind === 'message') {
            acc += ev.value;
            onToken(acc);
          } else if (ev.kind === 'error') {
            throw new Error(ev.value);
          }
        }
      }
      return acc;
    };

    try {
      const memberOutputs: { label: string; roleTitle: string; text: string }[] = [];

      for (let idx = 0; idx < initialMembers.length; idx++) {
        const member = initialMembers[idx];

        updateActiveSession((prev) => ({
          ...prev,
          messages: prev.messages.map((m) =>
            m.id === assistantMsgId && m.councilData
              ? {
                  ...m,
                  councilData: {
                    ...m.councilData,
                    members: m.councilData.members.map((mem, i) =>
                      i === idx ? { ...mem, status: 'streaming' } : mem
                    ),
                  },
                }
              : m
          ),
        }));

        let roleInstruction = '';
        if (strategyToUse === 'debate') {
          if (idx === 0) {
            roleInstruction =
              'تو عضو اول «شورای مدل‌ها» هستی. یک راه‌حل یا تحلیل مستقیم، ساختاریافته و دفاع‌پذیر برای خواسته کاربر ارائه بده:';
          } else if (idx === 1) {
            roleInstruction = `تو عضو منتقد «شورای مدل‌ها» (چالش‌گر) هستی. پاسخ عضو اول را بخوان، نقاط ضعف، ریسک‌ها یا فرضیات پنهان آن را نقد کن و دیدگاه جایگزین یا دقیق‌تری ارائه بده.\n\n[پاسخ عضو اول (${memberOutputs[0]?.label || 'مدل اول'})]:\n${memberOutputs[0]?.text || ''}\n\n[خواسته اصلی کاربر]:`;
          } else {
            roleInstruction = `تو عضو سوم «شورای مدل‌ها» (تحلیل‌گر بی‌طرف و ریسک‌سنج) هستی. با توجه به دیدگاه اول و نقد عضو دوم، زوایای پنهان، راهکارهای نوآورانه و نکات عملی که جا افتاده‌اند را مطرح کن.\n\n[خلاصه دیدگاه اول]:\n${memberOutputs[0]?.text || ''}\n\n[نقد عضو دوم]:\n${memberOutputs[1]?.text || ''}\n\n[خواسته اصلی کاربر]:`;
          }
        } else {
          if (idx === 0) {
            roleInstruction =
              'تو عضو اول «شورای مدل‌ها» (تحلیل جامع و کاربردی) هستی. به این پرسش به صورت دقیق، مرحله‌به‌مرحله و مستدل پاسخ بده:';
          } else if (idx === 1) {
            roleInstruction =
              'تو عضو دوم «شورای مدل‌ها» (بررسی دقیق و ساختاری) هستی. به این پرسش با تمرکز بر نکات کلیدی، استثناها و کیفیت اجرایی پاسخ بده:';
          } else {
            roleInstruction =
              'تو عضو سوم «شورای مدل‌ها» (استدلال و نگاه مکمل) هستی. به این پرسش با نگاهی نوآورانه، کاربردی و متفاوت پاسخ بده:';
          }
        }

        const fullMemberPrompt = `${roleInstruction}\n\n${userPrompt}`;

        try {
          const finalMemberText = await streamSingleModel(
            member.id,
            fullMemberPrompt,
            (partial) => {
              updateActiveSession((prev) => ({
                ...prev,
                messages: prev.messages.map((m) =>
                  m.id === assistantMsgId && m.councilData
                    ? {
                        ...m,
                        councilData: {
                          ...m.councilData,
                          members: m.councilData.members.map((mem, i) =>
                            i === idx ? { ...mem, text: partial, status: 'streaming' } : mem
                          ),
                        },
                      }
                    : m
                ),
              }));
            }
          );

          memberOutputs.push({
            label: member.name,
            roleTitle: member.roleTitle,
            text: finalMemberText,
          });

          updateActiveSession((prev) => ({
            ...prev,
            messages: prev.messages.map((m) =>
              m.id === assistantMsgId && m.councilData
                ? {
                    ...m,
                    councilData: {
                      ...m.councilData,
                      members: m.councilData.members.map((mem, i) =>
                        i === idx
                          ? { ...mem, text: finalMemberText, status: 'done' }
                          : mem
                      ),
                    },
                  }
                : m
            ),
          }));
        } catch (memberErr: any) {
          if (memberErr?.name === 'AbortError') throw memberErr;
          const fallbackMsg = 'خطا در دریافت دیدگاه این مدل.';
          memberOutputs.push({
            label: member.name,
            roleTitle: member.roleTitle,
            text: fallbackMsg,
          });
          updateActiveSession((prev) => ({
            ...prev,
            messages: prev.messages.map((m) =>
              m.id === assistantMsgId && m.councilData
                ? {
                    ...m,
                    councilData: {
                      ...m.councilData,
                      members: m.councilData.members.map((mem, i) =>
                        i === idx
                          ? { ...mem, text: fallbackMsg, status: 'error' }
                          : mem
                      ),
                    },
                  }
                : m
            ),
          }));
        }
      }

      // Stage 2: Final Synthesis / Judging
      updateActiveSession((prev) => ({
        ...prev,
        messages: prev.messages.map((m) =>
          m.id === assistantMsgId && m.councilData
            ? {
                ...m,
                councilData: {
                  ...m.councilData,
                  stage: 'judging',
                },
              }
            : m
        ),
      }));

      const judgePrompt =
        strategyToUse === 'debate'
          ? `تو «داور نهایی شورای مدل‌ها» هستی. سه مدل هوش مصنوعی درباره خواسته کاربر با هم مناظره و تبادل نظر کرده‌اند.
وظیفه تو:
۱. بهترین و دقیق‌ترین بخش‌های هر سه دیدگاه را ترکیب کن و نقاط ضعف مطرح‌شده در نقدها را برطرف ساز.
۲. یک پاسخ جامع، بی‌نقص، ساختاریافته و نهایی به زبان کاربر ارائه بده.
۳. در انتهای پاسخ، یک بخش کوتاه با عنوان «چکیده مناظره شورا» اضافه کن و در ۲ یا ۳ خط بگو هر مدل چه نکته کلیدی یا نقد مهمی را به پاسخ نهایی اضافه کرد.

[خواسته کاربر]:
${userPrompt}

[دیدگاه ۱ - ${memberOutputs[0]?.label} (${memberOutputs[0]?.roleTitle})]:
${memberOutputs[0]?.text}

[دیدگاه ۲ - ${memberOutputs[1]?.label} (${memberOutputs[1]?.roleTitle})]:
${memberOutputs[1]?.text}

[دیدگاه ۳ - ${memberOutputs[2]?.label} (${memberOutputs[2]?.roleTitle})]:
${memberOutputs[2]?.text}`
          : `تو «رئیس و جمع‌بندی‌کننده شورای مدل‌ها» هستی. سه مدل مستقل هوش مصنوعی به پرسش کاربر پاسخ داده‌اند.
وظیفه تو:
۱. نقاط قوت، دقت فنی و ایده‌های برتر هر سه پاسخ را در هم ادغام کن و هرگونه خطا یا نقص احتمالی را حذف کن.
۲. یک پاسخ نهایی یکپارچه، عمیق، خوش‌ساخت و کامل به زبان کاربر بنویس (به گونه‌ای که کامل‌ترین مرجع برای کاربر باشد).
۳. در انتهای پاسخ، یک بخش کوتاه با عنوان «هم‌افزایی شورا» بنویس و به اختصار اشاره کن ترکیب دیدگاه‌های این سه مدل چطور پاسخ را کامل‌تر کرد.

[خواسته کاربر]:
${userPrompt}

[پاسخ ۱ - ${memberOutputs[0]?.label} (${memberOutputs[0]?.roleTitle})]:
${memberOutputs[0]?.text}

[پاسخ ۲ - ${memberOutputs[1]?.label} (${memberOutputs[1]?.roleTitle})]:
${memberOutputs[1]?.text}

[پاسخ ۳ - ${memberOutputs[2]?.label} (${memberOutputs[2]?.roleTitle})]:
${memberOutputs[2]?.text}`;

      let synthesizedText = '';
      synthesizedText = await streamSingleModel('gpt-6-luna', judgePrompt, (partial) => {
        updateActiveSession((prev) => ({
          ...prev,
          messages: prev.messages.map((m) =>
            m.id === assistantMsgId ? { ...m, text: partial } : m
          ),
        }));
      });

      updateActiveSession((prev) => {
        const nextHistory: DuckHistoryMessage[] = [
          ...prev.history,
          { role: 'user', content: [{ type: 'text', text: userPrompt + promptExtra }] },
          { role: 'assistant', content: synthesizedText },
        ];

        return {
          ...prev,
          history: nextHistory,
          messages: prev.messages.map((m) =>
            m.id === assistantMsgId && m.councilData
              ? {
                  ...m,
                  text: synthesizedText,
                  isStreaming: false,
                  councilData: {
                    ...m.councilData,
                    stage: 'done',
                  },
                }
              : m
          ),
        };
      });
    } catch (err: any) {
      if (err?.name !== 'AbortError') {
        setErrorBanner(err?.message || 'خطا در اجرای شورای مدل‌ها');
      }
      updateActiveSession((prev) => ({
        ...prev,
        messages: prev.messages.map((m) =>
          m.id === assistantMsgId
            ? {
                ...m,
                text: m.text || 'اجرای شورای مدل‌ها متوقف شد.',
                isStreaming: false,
                councilData: m.councilData
                  ? { ...m.councilData, stage: 'done' }
                  : undefined,
              }
            : m
        ),
      }));
    } finally {
      setIsStreaming(false);
      abortControllerRef.current = null;
    }
  };

  const handleEditMessage = async (messageId: string, newText: string) => {
    if (isStreaming) return;
    const msgIndex = activeSession.messages.findIndex((m) => m.id === messageId);
    if (msgIndex === -1) return;

    const targetMsg = activeSession.messages[msgIndex];
    const pairedAssistantMsg =
      activeSession.messages[msgIndex + 1]?.role === 'assistant'
        ? activeSession.messages[msgIndex + 1]
        : undefined;
    const priorMessages = activeSession.messages.slice(0, msgIndex);
    const priorHistory = rebuildHistoryFromMessages(priorMessages);

    const imagesToSend = targetMsg.images || [];
    const filesToSend = targetMsg.files || [];

    if (pairedAssistantMsg?.councilData || councilMode) {
      await executeCouncilTurn({
        userPrompt: newText,
        strategyToUse: pairedAssistantMsg?.councilData?.mode || councilStrategy,
        filesToUse: filesToSend,
        baseMessagesOverride: priorMessages,
        baseHistoryOverride: priorHistory,
      });
      return;
    }

    const autoDetectedDraw =
      !drawMode &&
      imagesToSend.length === 0 &&
      filesToSend.length === 0 &&
      isImageGenerationPrompt(newText);
    const isDraw = Boolean(targetMsg.isDrawRequest || drawMode || autoDetectedDraw);

    const currentModelMeta = MODEL_OPTIONS.find((m) => m.id === selectedModel);
    const effectiveModel =
      isDraw && currentModelMeta && !currentModelMeta.supportsDraw
        ? 'gpt-6-luna'
        : selectedModel;

    await executeChatTurn({
      userPrompt: newText,
      isDraw,
      qualityToUse: targetMsg.imageQuality || imageQuality,
      aspectRatioToUse: targetMsg.imageAspectRatio || imageAspectRatio,
      imagesToUse: imagesToSend,
      filesToUse: filesToSend,
      modelToUse: effectiveModel,
      baseMessagesOverride: priorMessages,
      baseHistoryOverride: priorHistory,
    });
  };

  const handleRegenerateMessage = async (messageId: string) => {
    if (isStreaming) return;
    const clickedIndex = activeSession.messages.findIndex((m) => m.id === messageId);
    if (clickedIndex === -1) return;

    const clickedMsg = activeSession.messages[clickedIndex];
    let userMsgIndex = clickedIndex;

    if (clickedMsg.role === 'assistant') {
      userMsgIndex = -1;
      for (let i = clickedIndex - 1; i >= 0; i--) {
        if (activeSession.messages[i].role === 'user') {
          userMsgIndex = i;
          break;
        }
      }
    }

    if (userMsgIndex === -1) return;

    const targetUserMsg = activeSession.messages[userMsgIndex];
    const pairedAssistantMsg =
      activeSession.messages[userMsgIndex + 1]?.role === 'assistant'
        ? activeSession.messages[userMsgIndex + 1]
        : undefined;

    const priorMessages = activeSession.messages.slice(0, userMsgIndex);
    const priorHistory = rebuildHistoryFromMessages(priorMessages);

    if (targetUserMsg.text.trim() === '/help') {
      const nowTime = new Date().toLocaleTimeString('fa-IR', {
        hour: '2-digit',
        minute: '2-digit',
      });
      updateActiveSession((prev) => ({
        ...prev,
        history: priorHistory,
        messages: [
          ...priorMessages,
          {
            id: `u-${Date.now()}`,
            role: 'user',
            text: '/help',
            model: selectedModel,
            timestamp: nowTime,
          },
          {
            id: `a-${Date.now() + 1}`,
            role: 'assistant',
            text: HELP_TEXT,
            model: selectedModel,
            timestamp: nowTime,
          },
        ],
      }));
      return;
    }

    const imagesToSend = targetUserMsg.images || [];
    const filesToSend = targetUserMsg.files || [];

    if (pairedAssistantMsg?.councilData) {
      await executeCouncilTurn({
        userPrompt: targetUserMsg.text,
        strategyToUse: pairedAssistantMsg.councilData.mode,
        filesToUse: filesToSend,
        baseMessagesOverride: priorMessages,
        baseHistoryOverride: priorHistory,
      });
      return;
    }

    const isDraw = Boolean(
      targetUserMsg.isDrawRequest ||
        pairedAssistantMsg?.isDrawRequest ||
        pairedAssistantMsg?.generatedImage ||
        (imagesToSend.length === 0 &&
          filesToSend.length === 0 &&
          isImageGenerationPrompt(targetUserMsg.text))
    );

    const currentModelMeta = MODEL_OPTIONS.find((m) => m.id === selectedModel);
    const effectiveModel =
      isDraw && currentModelMeta && !currentModelMeta.supportsDraw
        ? 'gpt-6-luna'
        : selectedModel;

    await executeChatTurn({
      userPrompt: targetUserMsg.text,
      isDraw,
      qualityToUse:
        targetUserMsg.imageQuality ||
        pairedAssistantMsg?.imageQuality ||
        imageQuality,
      aspectRatioToUse:
        targetUserMsg.imageAspectRatio ||
        pairedAssistantMsg?.imageAspectRatio ||
        imageAspectRatio,
      imagesToUse: imagesToSend,
      filesToUse: filesToSend,
      modelToUse: effectiveModel,
      baseMessagesOverride: priorMessages,
      baseHistoryOverride: priorHistory,
    });
  };

  const handleSubmitImageEdit = async (
    sourceDataUri: string,
    editInstruction: string,
    aspectRatioOverride?: ImageAspectRatio
  ) => {
    if (isStreaming) return;
    setErrorBanner(null);
    try {
      const convertedRef = await convertDataUrlToWebP(
        sourceDataUri,
        'reference-image.webp'
      );
      const currentModelMeta = MODEL_OPTIONS.find((m) => m.id === selectedModel);
      const effectiveModel =
        currentModelMeta && !currentModelMeta.supportsDraw
          ? 'gpt-6-luna'
          : selectedModel;

      await executeChatTurn({
        userPrompt: `این تصویر را طبق این دستور ویرایش کن و تصویر جدید را بساز: ${editInstruction}`,
        isDraw: true,
        qualityToUse: imageQuality,
        aspectRatioToUse: aspectRatioOverride || imageAspectRatio,
        imagesToUse: [convertedRef],
        filesToUse: [],
        modelToUse: effectiveModel,
      });
    } catch (err: any) {
      setErrorBanner(err?.message || 'خطا در آماده‌سازی تصویر برای ویرایش');
    }
  };

  const handleSubmit = async () => {
    const trimmed = prompt.trim();
    if (!trimmed && pendingImages.length === 0 && pendingFiles.length === 0) {
      return;
    }

    const slash = parseSlashCommand(trimmed);
    if (slash.type === 'live') {
      setIsLiveVoiceOpen(true);
      setPrompt('');
      return;
    }

    if (slash.type === 'clear' || slash.type === 'exit') {
      updateActiveSession((prev) => ({
        ...prev,
        messages: [],
        history: [],
      }));
      setPrompt('');
      return;
    }

    if (slash.type === 'help') {
      const nowTime = new Date().toLocaleTimeString('fa-IR', {
        hour: '2-digit',
        minute: '2-digit',
      });
      updateActiveSession((prev) => ({
        ...prev,
        messages: [
          ...prev.messages,
          {
            id: `u-${Date.now()}`,
            role: 'user',
            text: '/help',
            model: selectedModel,
            timestamp: nowTime,
          },
          {
            id: `a-${Date.now() + 1}`,
            role: 'assistant',
            text: HELP_TEXT,
            model: selectedModel,
            timestamp: nowTime,
          },
        ],
      }));
      setPrompt('');
      return;
    }

    if (slash.type === 'model') {
      if (!slash.arg) {
        setModelPickerOpen(true);
        setPrompt('');
        return;
      }
      const nextModel = resolveModel(slash.arg, selectedModel);
      setSelectedModel(nextModel);
      setPrompt('');
      return;
    }

    if (slash.type === 'council' || (councilMode && slash.type === 'none')) {
      const councilPrompt =
        slash.type === 'council' ? slash.prompt : trimmed;
      if (!councilPrompt) {
        setCouncilMode(true);
        setDrawMode(false);
        setPrompt('');
        return;
      }
      const filesToSend = [...pendingFiles];
      setPrompt('');
      setPendingImages([]);
      setPendingFiles([]);
      await executeCouncilTurn({
        userPrompt: councilPrompt,
        strategyToUse: councilStrategy,
        filesToUse: filesToSend,
      });
      return;
    }

    const autoDetectedDraw =
      !drawMode &&
      slash.type === 'none' &&
      pendingImages.length === 0 &&
      pendingFiles.length === 0 &&
      isImageGenerationPrompt(trimmed);
    const isDraw = slash.type === 'draw' ? true : drawMode || autoDetectedDraw;
    const effectivePrompt =
      slash.type === 'draw'
        ? slash.prompt || 'یک منظره طبیعی رویایی'
        : trimmed || 'این فایل پیوست را بررسی کن.';

    const currentModelMeta = MODEL_OPTIONS.find((m) => m.id === selectedModel);
    const effectiveModel =
      isDraw && currentModelMeta && !currentModelMeta.supportsDraw
        ? 'gpt-6-luna'
        : selectedModel;

    let detectedQuality: ImageQualityTier = imageQuality;
    if (/\b4k\b/i.test(effectivePrompt)) {
      detectedQuality = '4K';
    } else if (/\b2k\b/i.test(effectivePrompt)) {
      detectedQuality = '2K';
    } else if (/\b1k\b/i.test(effectivePrompt)) {
      detectedQuality = '1K';
    }

    let detectedRatio: ImageAspectRatio = imageAspectRatio;
    if (/16:9/.test(effectivePrompt)) {
      detectedRatio = '16:9';
    } else if (/9:16/.test(effectivePrompt)) {
      detectedRatio = '9:16';
    } else if (/4:3/.test(effectivePrompt)) {
      detectedRatio = '4:3';
    } else if (/3:4/.test(effectivePrompt)) {
      detectedRatio = '3:4';
    } else if (/1:1/.test(effectivePrompt)) {
      detectedRatio = '1:1';
    }

    const imagesToSend = [...pendingImages];
    const filesToSend = [...pendingFiles];

    setPrompt('');
    setPendingImages([]);
    setPendingFiles([]);
    if (slash.type === 'draw') {
      setDrawMode(false);
    }

    await executeChatTurn({
      userPrompt: effectivePrompt,
      isDraw,
      qualityToUse: detectedQuality,
      aspectRatioToUse: detectedRatio,
      imagesToUse: imagesToSend,
      filesToUse: filesToSend,
      modelToUse: effectiveModel,
    });
  };

  const sidebarItems: ChatSessionItem[] = conversations.map((c) => ({
    id: c.id,
    title: c.title,
    model: c.model,
    updatedAt: c.updatedAt,
    messageCount: c.messages.length,
  }));

  return (
    <div className="flex h-dvh w-full overflow-hidden bg-zinc-50 dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100">
      <WelcomeCelebration key={celebrationKey} />
      <ChatSidebar
        sessions={sidebarItems}
        activeSessionId={activeSession.id}
        onSelectSession={setActiveSessionId}
        onNewChat={handleNewChat}
        onRenameSession={handleRenameSession}
        onDeleteSession={handleDeleteSession}
        onClearAllSessions={handleClearAllSessions}
        isDark={isDark}
        onToggleTheme={handleToggleTheme}
        mobileOpen={mobileSidebarOpen}
        onCloseMobile={() => setMobileSidebarOpen(false)}
      />

      <div className="flex-1 flex flex-col min-w-0 h-full">
        {/* Minimalist ChatGPT Header */}
        <header className="h-14 px-3 sm:px-6 bg-zinc-50/85 dark:bg-zinc-950/85 backdrop-blur-md flex items-center justify-between gap-3 shrink-0 z-30">
          <div className="flex items-center gap-1 shrink-0">
            <button
              type="button"
              onClick={() => setMobileSidebarOpen(true)}
              aria-label="بازکردن منوی گفتگوها"
              className="lg:hidden min-h-[44px] min-w-[44px] rounded-2xl flex items-center justify-center text-zinc-700 dark:text-zinc-300 hover:bg-zinc-200/60 dark:hover:bg-zinc-800 transition-colors cursor-pointer"
            >
              <Menu className="w-5 h-5" />
            </button>

            <ModelSwitcher
              selectedModel={selectedModel}
              onSelectModel={setSelectedModel}
              externalOpen={modelPickerOpen}
              onExternalOpenChange={setModelPickerOpen}
            />
          </div>

          {/* Active Conversation Title Only (Larger Font Size) */}
          <div className="flex-1 min-w-0 flex items-center justify-center px-2">
            <h2 className="text-base sm:text-lg font-bold text-zinc-800 dark:text-zinc-100 truncate text-center">
              {activeSession.title}
            </h2>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              onClick={handleNewChat}
              aria-label="گفتگوی جدید"
              className="min-h-[40px] px-3 py-2 rounded-2xl text-xs font-medium text-zinc-700 dark:text-zinc-300 hover:bg-zinc-200/60 dark:hover:bg-zinc-800 flex items-center gap-1.5 transition-colors cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              <span className="hidden sm:inline">گفتگوی جدید</span>
            </button>
          </div>
        </header>

        <main className="flex-1 overflow-y-auto flex flex-col">
          <ChatMessageList
            messages={activeSession.messages}
            selectedModel={selectedModel}
            isStreaming={isStreaming}
            onEditMessage={handleEditMessage}
            onRegenerateMessage={handleRegenerateMessage}
            onOpenImageLightbox={setLightboxItem}
          />
          <div ref={feedEndRef} />
        </main>

        <ChatComposer
          prompt={prompt}
          onPromptChange={setPrompt}
          onSubmit={handleSubmit}
          onStop={() => abortControllerRef.current?.abort()}
          isStreaming={isStreaming}
          drawMode={drawMode}
          onToggleDrawMode={() => {
            const next = !drawMode;
            setDrawMode(next);
            if (next) setCouncilMode(false);
          }}
          councilMode={councilMode}
          onToggleCouncilMode={() => {
            const next = !councilMode;
            setCouncilMode(next);
            if (next) setDrawMode(false);
          }}
          councilStrategy={councilStrategy}
          onSelectCouncilStrategy={setCouncilStrategy}
          imageQuality={imageQuality}
          onSelectImageQuality={setImageQuality}
          imageAspectRatio={imageAspectRatio}
          onSelectImageAspectRatio={setImageAspectRatio}
          pendingImages={pendingImages}
          onRemoveImage={(id) =>
            setPendingImages((prev) => prev.filter((item) => item.id !== id))
          }
          onUploadImages={handleUploadImages}
          pendingFiles={pendingFiles}
          onRemoveFile={(id) =>
            setPendingFiles((prev) => prev.filter((item) => item.id !== id))
          }
          onUploadTextFiles={handleUploadTextFiles}
          errorBanner={errorBanner}
          onDismissError={() => setErrorBanner(null)}
          selectedModel={selectedModel}
          onOpenLiveVoice={() => setIsLiveVoiceOpen(true)}
        />
      </div>

      <ImageLightboxModal
        item={lightboxItem}
        onClose={() => setLightboxItem(null)}
        onSubmitImageEdit={handleSubmitImageEdit}
        isStreaming={isStreaming}
      />

      <LiveVoiceModal
        isOpen={isLiveVoiceOpen}
        onClose={() => setIsLiveVoiceOpen(false)}
        selectedModel={selectedModel}
        onAddTranscriptToChat={handleAddVoiceTranscriptToChat}
        initialHistory={activeSession.history}
      />
    </div>
  );
}
