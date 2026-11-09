'use client';

import React, { useState } from 'react';
import {
  Plus,
  MessageSquare,
  Search,
  Pin,
  Trash2,
  Pencil,
  Check,
  Sun,
  Moon,
  X,
} from 'lucide-react';
import { MODEL_OPTIONS } from '@/lib/duck-protocol';

export interface ChatSessionItem {
  id: string;
  title: string;
  model: string;
  updatedAt: number;
  messageCount: number;
  pinned?: boolean;
  searchText?: string;
}

interface ChatSidebarProps {
  sessions: ChatSessionItem[];
  activeSessionId: string;
  onSelectSession: (id: string) => void;
  onNewChat: () => void;
  onTogglePin: (id: string) => void;
  onRenameSession: (id: string, newTitle: string) => void;
  onDeleteSession: (id: string) => void;
  onClearAllSessions: () => void;
  isDark: boolean;
  onToggleTheme: () => void;
  mobileOpen: boolean;
  onCloseMobile: () => void;
}

export function ChatSidebar({
  sessions,
  activeSessionId,
  onSelectSession,
  onNewChat,
  onTogglePin,
  onRenameSession,
  onDeleteSession,
  onClearAllSessions,
  isDark,
  onToggleTheme,
  mobileOpen,
  onCloseMobile,
}: ChatSidebarProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState<string>('');
  const [searchQuery, setSearchQuery] = useState('');
  const normalizedQuery = searchQuery.trim().toLocaleLowerCase();
  const visibleSessions = sessions
    .filter((session) => !normalizedQuery || `${session.title} ${session.searchText || ''}`.toLocaleLowerCase().includes(normalizedQuery))
    .slice()
    .sort((a, b) => Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)) || b.updatedAt - a.updatedAt);

  const handleStartRename = (session: ChatSessionItem, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingId(session.id);
    setEditTitle(session.title);
  };

  const handleCommitRename = (id: string) => {
    const trimmed = editTitle.trim();
    if (trimmed) {
      onRenameSession(id, trimmed);
    }
    setEditingId(null);
    setEditTitle('');
  };

  const handleCancelRename = () => {
    setEditingId(null);
    setEditTitle('');
  };

  const sidebarContent = (
    <div className="flex flex-col h-full bg-zinc-100/90 dark:bg-zinc-900/95 border-l border-zinc-200/80 dark:border-zinc-800/80 text-zinc-900 dark:text-zinc-100 select-none">
      {/* Iridescent home mark, adapted to fit the sidebar. */}
      <div className="sabi-sidebar-brand" aria-label="SABI-AI">
        <div className="sabi-hero sabi-hero-sidebar" aria-hidden="true">
          <div className="sabi-hero-aura" />
          <div className="sabi-hero-orbit sabi-hero-orbit-one"><i /></div>
          <div className="sabi-hero-orbit sabi-hero-orbit-two"><i /></div>
          <span className="sabi-hero-spark sabi-hero-spark-one">✦</span>
          <span className="sabi-hero-spark sabi-hero-spark-two">✧</span>
          <div className="sabi-hero-word" dir="ltr">SABI-AI</div>
        </div>
      </div>
      {/* Top Action Header */}
      <div className="p-3.5 flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => {
            onNewChat();
            onCloseMobile();
          }}
          className="flex-1 min-h-[44px] px-4 py-2.5 rounded-2xl bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-950 font-semibold text-sm flex items-center justify-between hover:opacity-90 transition-opacity cursor-pointer"
        >
          <span>گفتگوی جدید</span>
          <Plus className="w-4 h-4" />
        </button>

        <button
          type="button"
          onClick={onCloseMobile}
          aria-label="بستن منوی کناری"
          className="lg:hidden min-h-[44px] min-w-[44px] rounded-2xl flex items-center justify-center text-zinc-500 hover:bg-zinc-200 dark:hover:bg-zinc-800 transition-colors cursor-pointer"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      <div className="px-3.5 pb-1">
        <label className="sabi-search-box">
          <Search size={16} aria-hidden="true" />
          <input value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} placeholder="جستجو در گفتگوها..." aria-label="جستجو در عنوان و متن گفتگوها" />
          {searchQuery && <button type="button" onClick={() => setSearchQuery('')} aria-label="پاک کردن جستجو"><X size={14} /></button>}
        </label>
      </div>
      {/* Chat History List */}
      <div className="flex-1 overflow-y-auto px-3 py-2 space-y-1">
        <div className="px-2.5 py-1.5 flex items-center justify-between text-xs font-medium text-zinc-400 dark:text-zinc-500">
          <span>گفتگوهای اخیر</span>
          {sessions.length > 1 && (
            <button
              type="button"
              onClick={onClearAllSessions}
              className="text-[11px] text-zinc-400 hover:text-red-500 transition-colors cursor-pointer"
            >
              حذف همه
            </button>
          )}
        </div>

        {visibleSessions.length === 0 && <p className="px-3 py-5 text-center text-xs text-zinc-500" role="status">گفتگویی پیدا نشد.</p>}
        {visibleSessions.map((session) => {
          const isActive = session.id === activeSessionId;
          const isEditing = editingId === session.id;
          const modelMeta = MODEL_OPTIONS.find((m) => m.id === session.model);

          return (
            <div
              key={session.id}
              className={`group flex items-center justify-between gap-1 rounded-2xl px-3 py-2.5 transition-colors ${
                isActive
                  ? 'bg-white dark:bg-zinc-800/90 shadow-xs text-zinc-900 dark:text-zinc-100'
                  : 'hover:bg-zinc-200/60 dark:hover:bg-zinc-800/40 text-zinc-600 dark:text-zinc-300'
              }`}
            >
              {isEditing ? (
                <div className="flex-1 flex items-center gap-1 min-w-0">
                  <input
                    type="text"
                    value={editTitle}
                    onChange={(e) => setEditTitle(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        handleCommitRename(session.id);
                      } else if (e.key === 'Escape') {
                        handleCancelRename();
                      }
                    }}
                    aria-label="نام جدید گفتگو"
                    autoFocus
                    className="flex-1 min-w-0 px-2.5 py-1 rounded-xl text-xs bg-zinc-100 dark:bg-zinc-900 border border-zinc-300 dark:border-zinc-700 text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-1 focus:ring-amber-500"
                  />
                  <button
                    type="button"
                    onClick={() => handleCommitRename(session.id)}
                    aria-label="ذخیره نام گفتگو"
                    className="p-1.5 rounded-xl text-emerald-500 hover:bg-emerald-500/10 transition-colors cursor-pointer shrink-0"
                  >
                    <Check className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={handleCancelRename}
                    aria-label="انصراف از تغییر نام"
                    className="p-1.5 rounded-xl text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 hover:bg-zinc-200/60 dark:hover:bg-zinc-700/60 transition-colors cursor-pointer shrink-0"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={() => {
                      onSelectSession(session.id);
                      onCloseMobile();
                    }}
                    className="flex-1 min-w-0 text-right flex items-center gap-2.5 cursor-pointer"
                  >
                    <MessageSquare className="w-4 h-4 shrink-0 text-zinc-400 dark:text-zinc-500" />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium truncate">{session.title}</p>
                      <div className="flex items-center gap-1.5 text-[11px] text-zinc-400 dark:text-zinc-500 mt-0.5">
                        <span dir="ltr">{modelMeta?.name || session.model}</span>
                      </div>
                    </div>
                  </button>

                  <div className="flex items-center gap-0.5 shrink-0">
                    <button
                      type="button"
                      onClick={() => onTogglePin(session.id)}
                      aria-label={session.pinned ? `برداشتن سنجاق ${session.title}` : `سنجاق کردن ${session.title}`}
                      title={session.pinned ? 'برداشتن سنجاق' : 'سنجاق گفتگو'}
                      aria-pressed={Boolean(session.pinned)}
                      className={`p-1.5 rounded-xl hover:bg-zinc-200/70 dark:hover:bg-zinc-700/60 transition-colors cursor-pointer ${session.pinned ? 'text-amber-500' : 'text-zinc-400'}`}
                    ><Pin className="w-3.5 h-3.5" fill={session.pinned ? 'currentColor' : 'none'} /></button>
                    <button
                      type="button"
                      onClick={(e) => handleStartRename(session, e)}
                      aria-label={`تغییر نام گفتگوی ${session.title}`}
                      title="تغییر نام گفتگو"
                      className="opacity-75 group-hover:opacity-100 p-1.5 rounded-xl text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-zinc-200/70 dark:hover:bg-zinc-700/60 transition-colors cursor-pointer"
                    >
                      <Pencil className="w-3.5 h-3.5" />
                    </button>

                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onDeleteSession(session.id);
                      }}
                      aria-label={`حذف گفتگوی ${session.title}`}
                      title="حذف گفتگو"
                      className="opacity-75 group-hover:opacity-100 p-1.5 rounded-xl text-zinc-400 hover:text-red-500 hover:bg-zinc-200/70 dark:hover:bg-zinc-700/60 transition-colors cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </>
              )}
            </div>
          );
        })}
      </div>

      {/* Footer Theme Switcher */}
      <div className="p-3.5 border-t border-zinc-200/70 dark:border-zinc-800/70 flex items-center justify-between">
        <button
          type="button"
          onClick={onToggleTheme}
          aria-label={isDark ? 'تغییر به حالت روشن' : 'تغییر به حالت تیره'}
          className="w-full min-h-[44px] px-3.5 py-2 rounded-2xl hover:bg-zinc-200/70 dark:hover:bg-zinc-800/80 flex items-center justify-between text-xs font-medium text-zinc-600 dark:text-zinc-300 transition-colors cursor-pointer"
        >
          <span>{isDark ? 'حالت نمایش روشن' : 'حالت نمایش تیره'}</span>
          {isDark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
        </button>
      </div>
    </div>
  );

  return (
    <>
      <aside className="hidden lg:block w-72 shrink-0 h-full">{sidebarContent}</aside>

      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden flex">
          <div
            className="fixed inset-0 bg-black/60 backdrop-blur-xs"
            onClick={onCloseMobile}
            aria-hidden="true"
          />
          <aside className="relative w-76 max-w-[84vw] h-full z-10">{sidebarContent}</aside>
        </div>
      )}
    </>
  );
}
