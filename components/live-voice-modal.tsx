'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Mic,
  MicOff,
  Volume2,
  VolumeX,
  X,
  SlidersHorizontal,
  Send,
  Radio,
  Hand,
} from 'lucide-react';
import { DuckHistoryMessage } from '@/lib/duck-protocol';
import { apiUrl } from '@/lib/base-path';
import { SABI_IDENTITY } from '@/lib/assistant-identity';

export interface LiveVoiceTurn {
  role: 'user' | 'assistant';
  text: string;
  timestamp: string;
}

interface LiveVoiceModalProps {
  isOpen: boolean;
  onClose: () => void;
  selectedModel: string;
  onAddTranscriptToChat: (turns: LiveVoiceTurn[]) => void;
  initialHistory?: DuckHistoryMessage[];
}

export function LiveVoiceModal({
  isOpen,
  onClose,
  selectedModel,
  onAddTranscriptToChat,
  initialHistory = [],
}: LiveVoiceModalProps) {
  const [status, setStatus] = useState<
    'connecting' | 'listening' | 'thinking' | 'searching' | 'speaking' | 'ending' | 'error'
  >('connecting');
  const [statusText, setStatusText] = useState<string>('در حال اتصال...');
  const [isMuted, setIsMuted] = useState<boolean>(false);
  const [isSpeakerMuted, setIsSpeakerMuted] = useState<boolean>(false);
  const [volumeLevel, setVolumeLevel] = useState<number>(0.12);
  const [callSeconds, setCallSeconds] = useState<number>(0);

  // Input Mode: 'auto' (Server/Smart VAD) vs 'ptt' (Push-to-Talk with Space or Hold)
  const [inputMode, setInputMode] = useState<'auto' | 'ptt'>('auto');
  const [isHoldingPtt, setIsHoldingPtt] = useState<boolean>(false);

  // System Prompt / Pre-message drawer state
  const [isPromptDrawerOpen, setIsPromptDrawerOpen] = useState<boolean>(false);
  const [systemPrompt, setSystemPrompt] = useState<string>('');
  const [draftSystemPrompt, setDraftSystemPrompt] = useState<string>('');
  const [preMessageInput, setPreMessageInput] = useState<string>('');

  const [currentUserSpeech, setCurrentUserSpeech] = useState<string>('');
  const [currentAssistantSpeech, setCurrentAssistantSpeech] = useState<string>('');
  const [conversationTurns, setConversationTurns] = useState<LiveVoiceTurn[]>([]);

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const dcRef = useRef<RTCDataChannel | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const remoteAudioRef = useRef<HTMLAudioElement | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const remoteAnalyserRef = useRef<AnalyserNode | null>(null);
  const animFrameRef = useRef<number | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const isFallbackLiveRef = useRef<boolean>(false);
  const vadIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const autoDuckTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const isAutoDuckedRef = useRef<boolean>(false);

  const statusRef = useRef(status);
  const isMutedRef = useRef(isMuted);
  const isSpeakerMutedRef = useRef(isSpeakerMuted);
  const inputModeRef = useRef(inputMode);
  const isHoldingPttRef = useRef(isHoldingPtt);
  const systemPromptRef = useRef(systemPrompt);
  const conversationTurnsRef = useRef<LiveVoiceTurn[]>(conversationTurns);

  useEffect(() => {
    statusRef.current = status;
    isMutedRef.current = isMuted;
    isSpeakerMutedRef.current = isSpeakerMuted;
    inputModeRef.current = inputMode;
    isHoldingPttRef.current = isHoldingPtt;
    systemPromptRef.current = systemPrompt;
    conversationTurnsRef.current = conversationTurns;
  }, [status, isMuted, isSpeakerMuted, inputMode, isHoldingPtt, systemPrompt, conversationTurns]);

  // Sync actual microphone track enabled state based on manual mute, Push-to-Talk, and Auto-Ducking
  const syncMicTrackState = useCallback(() => {
    if (!localStreamRef.current) return;
    const shouldEnable =
      !isMutedRef.current &&
      !isAutoDuckedRef.current &&
      (inputModeRef.current === 'auto' || isHoldingPttRef.current);

    localStreamRef.current.getAudioTracks().forEach((track) => {
      track.enabled = shouldEnable;
    });
  }, []);

  // Call duration timer
  useEffect(() => {
    if (!isOpen) return;
    const startTime = Date.now();
    const interval = setInterval(() => {
      setCallSeconds(Math.floor((Date.now() - startTime) / 1000));
    }, 1000);
    return () => clearInterval(interval);
  }, [isOpen]);

  const formatDuration = (totalSeconds: number) => {
    const mins = Math.floor(totalSeconds / 60);
    const secs = totalSeconds % 60;
    return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  };

  // Option 1: Real audio energy tracking for BOTH user microphone AND remote WebRTC AI audio
  useEffect(() => {
    if (!isOpen) return;

    let phase = 0;
    const freqBins = new Uint8Array(32);

    const tick = () => {
      phase += 0.04;
      if (statusRef.current === 'speaking' && remoteAnalyserRef.current) {
        remoteAnalyserRef.current.getByteFrequencyData(freqBins);
        let sum = 0;
        for (let i = 0; i < freqBins.length; i++) {
          sum += freqBins[i];
        }
        const avg = sum / (freqBins.length * 255);
        if (avg > 0.01) {
          setVolumeLevel((prev) => prev * 0.65 + Math.min(0.65, avg * 1.45) * 0.35);
        } else {
          const wave = 0.28 + Math.sin(phase * 2.6) * 0.12 + Math.cos(phase * 4.1) * 0.06;
          setVolumeLevel(wave);
        }
      } else if (analyserRef.current && statusRef.current === 'listening') {
        analyserRef.current.getByteFrequencyData(freqBins);
        let sum = 0;
        for (let i = 0; i < freqBins.length; i++) {
          sum += freqBins[i];
        }
        const avg = sum / (freqBins.length * 255);
        setVolumeLevel((prev) => prev * 0.72 + avg * 0.28);
      } else if (statusRef.current === 'speaking') {
        const wave = 0.32 + Math.sin(phase * 2.6) * 0.14 + Math.cos(phase * 4.1) * 0.08;
        setVolumeLevel(wave);
      } else if (statusRef.current === 'thinking' || statusRef.current === 'searching') {
        setVolumeLevel(0.18 + Math.sin(phase * 3.2) * 0.06);
      } else {
        setVolumeLevel(0.1 + Math.sin(phase * 1.5) * 0.03);
      }
      animFrameRef.current = requestAnimationFrame(tick);
    };

    animFrameRef.current = requestAnimationFrame(tick);
    return () => {
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    };
  }, [isOpen]);

  const buildVoiceHistoryPayload = useCallback((): DuckHistoryMessage[] => {
    const history: DuckHistoryMessage[] = [...initialHistory];
    if (systemPromptRef.current.trim()) {
      history.push({
        role: 'user',
        content: `[دستورالعمل سیستم و نقش تو در این گفتگوی صوتی زنده]:\n${systemPromptRef.current.trim()}\nلطفاً در تمام پاسخ‌های بعدی دقیقاً بر اساس این نقش و دستورالعمل صحبت کن.`,
      });
      history.push({
        role: 'assistant',
        content: 'متوجه شدم؛ در تمام طول این مکالمه صوتی دقیقاً طبق همین دستورالعمل و نقش پاسخ می‌دهم.',
      });
    }
    for (const turn of conversationTurnsRef.current) {
      history.push({
        role: turn.role,
        content: turn.text,
      });
    }
    return history;
  }, [initialHistory]);

  const processUserTurnAndRespond = useCallback(
    async (userText: string, onCompleteCallback?: () => void) => {
      if (!userText.trim()) {
        onCompleteCallback?.();
        return;
      }

      setCurrentUserSpeech(userText);
      const nowStr = new Date().toLocaleTimeString('fa-IR', {
        hour: '2-digit',
        minute: '2-digit',
      });

      const historyBeforeTurn = buildVoiceHistoryPayload();

      setConversationTurns((prev) => [
        ...prev,
        { role: 'user', text: userText, timestamp: nowStr },
      ]);

      setStatus('thinking');
      setStatusText('در حال تفکر...');

      try {
        const sysInstruction = systemPromptRef.current.trim()
          ? `[دستورالعمل و نقش تو: ${systemPromptRef.current.trim()}]\n`
          : '';

        const chatRes = await fetch(apiUrl('/api/duckchat'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            prompt: `${sysInstruction}${userText}\n\n[لطفاً به صورت طبیعی، محاوره‌ای و مناسب گفتگوی صوتی در حد ۲ تا ۳ جمله کوتاه پاسخ بده.]`,
            model: selectedModel,
            history: historyBeforeTurn,
          }),
        });

        if (!chatRes.ok || !chatRes.body) throw new Error();

        const reader = chatRes.body.getReader();
        const decoder = new TextDecoder();
        let accText = '';
        let lineBuffer = '';

        setCurrentAssistantSpeech('');

        // Auto-duck mic while AI speaks
        isAutoDuckedRef.current = true;
        syncMicTrackState();

        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          lineBuffer += decoder.decode(value, { stream: true });
          const lines = lineBuffer.split('\n');
          lineBuffer = lines.pop() || '';

          for (const l of lines) {
            if (!l.trim()) continue;
            try {
              const ev = JSON.parse(l);
              if (ev.kind === 'message') {
                accText += ev.value;
                setCurrentAssistantSpeech(accText);
                setStatus('speaking');
                setStatusText('در حال صحبت...');
              }
            } catch {}
          }
        }

        if (accText) {
          setConversationTurns((prev) => [
            ...prev,
            { role: 'assistant', text: accText, timestamp: nowStr },
          ]);

          if (!isSpeakerMutedRef.current && 'speechSynthesis' in window) {
            window.speechSynthesis.cancel();
            const utterance = new SpeechSynthesisUtterance(accText.slice(0, 420));
            utterance.lang = /[\u0600-\u06FF]/.test(accText) ? 'fa-IR' : 'en-US';
            utterance.rate = 1.04;
            utterance.onend = () => {
              isAutoDuckedRef.current = false;
              syncMicTrackState();
              setStatus('listening');
              setStatusText(
                inputModeRef.current === 'ptt'
                  ? 'کلید Space یا گوی را برای صحبت نگه دارید'
                  : 'در حال شنیدن...'
              );
              onCompleteCallback?.();
            };
            utterance.onerror = () => {
              isAutoDuckedRef.current = false;
              syncMicTrackState();
              setStatus('listening');
              setStatusText(
                inputModeRef.current === 'ptt'
                  ? 'کلید Space یا گوی را برای صحبت نگه دارید'
                  : 'در حال شنیدن...'
              );
              onCompleteCallback?.();
            };
            window.speechSynthesis.speak(utterance);
            return;
          }
        }
      } catch {
        // ignore
      }

      isAutoDuckedRef.current = false;
      syncMicTrackState();
      setStatus('listening');
      setStatusText(
        inputModeRef.current === 'ptt'
          ? 'کلید Space یا گوی را برای صحبت نگه دارید'
          : 'در حال شنیدن...'
      );
      onCompleteCallback?.();
    },
    [buildVoiceHistoryPayload, selectedModel, syncMicTrackState]
  );

  // Option 3: Smart Energy-Based VAD Fallback Mode
  const startSmartFallbackLiveVoice = useCallback(
    (stream: MediaStream) => {
      isFallbackLiveRef.current = true;
      if (pcRef.current) {
        try {
          pcRef.current.close();
        } catch {}
        pcRef.current = null;
      }
      if (dcRef.current) {
        try {
          dcRef.current.close();
        } catch {}
        dcRef.current = null;
      }

      setStatus('listening');
      setStatusText(
        inputModeRef.current === 'ptt'
          ? 'کلید Space یا گوی را برای صحبت نگه دارید'
          : 'در حال شنیدن...'
      );

      let chunks: Blob[] = [];
      let recorder: MediaRecorder;
      try {
        recorder = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus' });
      } catch {
        recorder = new MediaRecorder(stream);
      }
      mediaRecorderRef.current = recorder;

      let hasDetectedSpeechInTurn = false;
      let lastSpeechTimestamp = Date.now();
      let recordingStartTime = Date.now();

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          chunks.push(e.data);
        }
      };

      recorder.onstop = async () => {
        if (!isFallbackLiveRef.current || chunks.length === 0) return;
        const audioBlob = new Blob(chunks, { type: 'audio/webm' });
        chunks = [];

        const shouldProcess =
          audioBlob.size >= 450 &&
          (hasDetectedSpeechInTurn || inputModeRef.current === 'ptt');

        if (!shouldProcess) {
          if (inputModeRef.current === 'auto') {
            startContinuousVadRecording();
          }
          return;
        }

        setStatus('thinking');
        setStatusText('در حال تفکر...');

        try {
          const dictRes = await fetch(apiUrl('/api/duckvoice/dictation'), {
            method: 'POST',
            headers: { 'x-model': selectedModel },
            body: audioBlob,
          });
          const dictData = await dictRes.json();
          const userText = dictData.text?.trim();

          if (userText) {
            await processUserTurnAndRespond(userText, () => {
              if (isFallbackLiveRef.current && inputModeRef.current === 'auto') {
                startContinuousVadRecording();
              }
            });
            return;
          }
        } catch {
          // ignore
        }

        if (isFallbackLiveRef.current) {
          setStatus('listening');
          setStatusText(
            inputModeRef.current === 'ptt'
              ? 'کلید Space یا گوی را برای صحبت نگه دارید'
              : 'در حال شنیدن...'
          );
          if (inputModeRef.current === 'auto') {
            startContinuousVadRecording();
          }
        }
      };

      function startContinuousVadRecording() {
        if (
          !isFallbackLiveRef.current ||
          recorder.state === 'recording' ||
          statusRef.current === 'speaking' ||
          statusRef.current === 'thinking'
        ) {
          return;
        }
        chunks = [];
        hasDetectedSpeechInTurn = false;
        lastSpeechTimestamp = Date.now();
        recordingStartTime = Date.now();

        try {
          recorder.start(200);
        } catch {}

        if (vadIntervalRef.current) clearInterval(vadIntervalRef.current);
        const bins = new Uint8Array(32);

        vadIntervalRef.current = setInterval(() => {
          if (!isFallbackLiveRef.current || recorder.state !== 'recording') {
            return;
          }
          if (inputModeRef.current === 'ptt') {
            // In PTT mode, stopping is controlled by releasing Space/Orb
            return;
          }
          if (isMutedRef.current || isAutoDuckedRef.current) {
            lastSpeechTimestamp = Date.now();
            return;
          }

          let avgEnergy = 0;
          if (analyserRef.current) {
            analyserRef.current.getByteFrequencyData(bins);
            let sum = 0;
            for (let i = 0; i < bins.length; i++) sum += bins[i];
            avgEnergy = sum / (bins.length * 255);
          }

          const now = Date.now();
          if (avgEnergy > 0.045) {
            hasDetectedSpeechInTurn = true;
            lastSpeechTimestamp = now;
          }

          // If speech was detected and then 1.15s of silence passed, commit the audio!
          if (hasDetectedSpeechInTurn && now - lastSpeechTimestamp > 1150) {
            if (vadIntervalRef.current) clearInterval(vadIntervalRef.current);
            try {
              recorder.stop();
            } catch {}
            return;
          }

          // If 8s passed with no speech at all, silently cycle the buffer
          if (!hasDetectedSpeechInTurn && now - recordingStartTime > 8000) {
            if (vadIntervalRef.current) clearInterval(vadIntervalRef.current);
            try {
              recorder.stop();
            } catch {}
          }
        }, 120);
      }

      if (inputModeRef.current === 'auto') {
        startContinuousVadRecording();
      }
    },
    [processUserTurnAndRespond, selectedModel]
  );

  function cleanup() {
    if (vadIntervalRef.current) {
      clearInterval(vadIntervalRef.current);
    }
    if (autoDuckTimeoutRef.current) {
      clearTimeout(autoDuckTimeoutRef.current);
    }
    if (animFrameRef.current) {
      cancelAnimationFrame(animFrameRef.current);
    }
    if (audioContextRef.current) {
      audioContextRef.current.close().catch(() => {});
    }
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((t) => t.stop());
    }
    if (pcRef.current) {
      pcRef.current.close();
    }
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      try {
        mediaRecorderRef.current.stop();
      } catch {}
    }
    if (typeof window !== 'undefined' && window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }
  }

  const handleEndCall = useCallback(() => {
    if (conversationTurnsRef.current.length > 0) {
      onAddTranscriptToChat(conversationTurnsRef.current);
    }
    cleanup();
    onClose();
  }, [onAddTranscriptToChat, onClose]);

  useEffect(() => {
    if (!isOpen) return;

    let isMounted = true;

    async function startLiveSession() {
      setStatus('connecting');
      setStatusText('در حال اتصال...');
      setConversationTurns([]);
      setCurrentUserSpeech('');
      setCurrentAssistantSpeech('');
      isFallbackLiveRef.current = false;
      isAutoDuckedRef.current = false;

      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: false,
            channelCount: 1,
            sampleRate: 48000,
          },
        });
        if (!isMounted) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        localStreamRef.current = stream;
        syncMicTrackState();

        try {
          const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
          const actx = new AudioContextClass();
          audioContextRef.current = actx;
          const src = actx.createMediaStreamSource(stream);
          const analyser = actx.createAnalyser();
          analyser.fftSize = 64;
          analyser.smoothingTimeConstant = 0.8;
          src.connect(analyser);
          analyserRef.current = analyser;
        } catch {
          // ignore
        }

        const journeyId =
          Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
        const iceRes = await fetch(apiUrl(`/api/duckvoice/session?journeyId=${journeyId}`));
        const iceData = await iceRes.json();
        const iceServers = iceData.iceServers || [
          { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
        ];

        const pc = new RTCPeerConnection({ iceServers });
        pcRef.current = pc;

        stream.getAudioTracks().forEach((track) => {
          pc.addTrack(track, stream);
        });

        const dc = pc.createDataChannel('duckai-voice-session');
        dcRef.current = dc;

        dc.onopen = () => {
          if (!isMounted) return;
          setStatus('listening');
          setStatusText(
            inputModeRef.current === 'ptt'
              ? 'کلید Space یا گوی را برای صحبت نگه دارید'
              : 'در حال شنیدن...'
          );

          // Give the realtime assistant its product identity, preserving any custom prompt.
          try {
            dc.send(
              JSON.stringify({
                type: 'session.update',
                session: { instructions: [SABI_IDENTITY, systemPromptRef.current.trim()].filter(Boolean).join('\n\n') },
              })
            );
          } catch {}
        };

        dc.onmessage = (e) => {
          if (!isMounted) return;
          try {
            const data = JSON.parse(e.data);
            const type = data.type || '';

            if (type === 'input_audio_buffer.speech_started') {
              setCurrentUserSpeech('');
              setStatus('listening');
              setStatusText('در حال شنیدن صدای شما...');
            } else if (type === 'input_audio_buffer.speech_stopped') {
              setStatus('thinking');
              setStatusText('در حال تفکر...');
            } else if (type === 'conversation.item.input_audio_transcription.delta') {
              // Option 2: Live word-by-word user speech delta
              const delta = data.delta || '';
              if (delta) {
                setCurrentUserSpeech((prev) => prev + delta);
              }
            } else if (type === 'conversation.item.input_audio_transcription.completed') {
              const text = (data.transcript || '').trim();
              if (text) {
                setCurrentUserSpeech(text);
                setConversationTurns((prev) => [
                  ...prev,
                  {
                    role: 'user',
                    text,
                    timestamp: new Date().toLocaleTimeString('fa-IR', {
                      hour: '2-digit',
                      minute: '2-digit',
                    }),
                  },
                ]);
              }
            } else if (type === 'response.created') {
              setCurrentAssistantSpeech('');
            } else if (type === 'response.output_audio_transcript.delta') {
              setStatus('speaking');
              setStatusText('در حال صحبت...');
              setCurrentAssistantSpeech((prev) => prev + (data.delta || ''));
            } else if (type === 'response.output_item.done') {
              const item = data.item || {};
              // Option 2: Handle WebSearch tool invocation
              if (item.type === 'function_call' && item.name === 'WebSearch') {
                setStatus('searching');
                setStatusText('در حال جستجوی وب...');
                return;
              }
              const content = (item.content || [{}])[0];
              const text = content?.transcript || '';
              if (text) {
                setCurrentAssistantSpeech(text);
                setConversationTurns((prev) => [
                  ...prev,
                  {
                    role: 'assistant',
                    text,
                    timestamp: new Date().toLocaleTimeString('fa-IR', {
                      hour: '2-digit',
                      minute: '2-digit',
                    }),
                  },
                ]);
              }
            } else if (type === 'output_audio_buffer.started') {
              // Option 1: Auto-Ducking when AI starts speaking (matches duck_voice.py & chunk.voice-session.js)
              setStatus('speaking');
              setStatusText('در حال صحبت...');
              isAutoDuckedRef.current = true;
              syncMicTrackState();
              if (autoDuckTimeoutRef.current) clearTimeout(autoDuckTimeoutRef.current);
              autoDuckTimeoutRef.current = setTimeout(() => {
                isAutoDuckedRef.current = false;
                syncMicTrackState();
              }, 1400);
            } else if (
              type === 'output_audio_buffer.stopped' ||
              type === 'output_audio_buffer.cleared'
            ) {
              // Re-enable mic immediately when AI stops speaking
              if (autoDuckTimeoutRef.current) clearTimeout(autoDuckTimeoutRef.current);
              isAutoDuckedRef.current = false;
              syncMicTrackState();
              setStatus('listening');
              setStatusText(
                inputModeRef.current === 'ptt'
                  ? 'کلید Space یا گوی را برای صحبت نگه دارید'
                  : 'در حال شنیدن...'
              );
            } else if (type === 'conversation.item.added') {
              // Option 2: Auto-End session when AI triggers termination function_call (e.g. user said goodbye)
              const item = data.item || {};
              if (item.type === 'function_call' && item.arguments) {
                try {
                  const args = JSON.parse(item.arguments);
                  if (args && args.reason) {
                    setStatus('ending');
                    setStatusText('پایان خودکار مکالمه...');
                    setTimeout(() => {
                      if (isMounted) {
                        handleEndCall();
                      }
                    }, 1800);
                  }
                } catch {}
              }
            }
          } catch {
            // ignore
          }
        };

        // Option 1: Connect remote WebRTC audio stream to HTMLAudioElement AND Remote AnalyserNode
        pc.ontrack = (event) => {
          const remoteStream = event.streams[0];
          if (!remoteStream) return;

          if (remoteAudioRef.current) {
            remoteAudioRef.current.srcObject = remoteStream;
            remoteAudioRef.current.play().catch(() => {});
          }

          try {
            if (audioContextRef.current) {
              const remoteSource =
                audioContextRef.current.createMediaStreamSource(remoteStream);
              const remoteAnalyser = audioContextRef.current.createAnalyser();
              remoteAnalyser.fftSize = 64;
              remoteAnalyser.smoothingTimeConstant = 0.75;
              remoteSource.connect(remoteAnalyser);
              remoteAnalyserRef.current = remoteAnalyser;
            }
          } catch {
            // ignore
          }
        };

        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);

        await new Promise((resolve) => {
          if (pc.iceGatheringState === 'complete') {
            resolve(true);
          } else {
            const check = () => {
              if (pc.iceGatheringState === 'complete') {
                pc.removeEventListener('icegatheringstatechange', check);
                resolve(true);
              }
            };
            pc.addEventListener('icegatheringstatechange', check);
            setTimeout(resolve, 1400);
          }
        });

        const sessRes = await fetch(apiUrl('/api/duckvoice/session'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sdp: pc.localDescription?.sdp || offer.sdp,
            voice: 'voice-1',
            journeyId,
          }),
        });

        const sessData = await sessRes.json();

        if (sessData.success && sessData.answerSdp) {
          await pc.setRemoteDescription(
            new RTCSessionDescription({ type: 'answer', sdp: sessData.answerSdp })
          );
        } else {
          startSmartFallbackLiveVoice(stream);
        }
      } catch {
        if (!isMounted) return;
        if (localStreamRef.current) {
          startSmartFallbackLiveVoice(localStreamRef.current);
        } else {
          setStatus('listening');
          setStatusText('در حال شنیدن...');
        }
      }
    }

    startLiveSession();

    return () => {
      isMounted = false;
      cleanup();
    };
  }, [handleEndCall, isOpen, startSmartFallbackLiveVoice, syncMicTrackState]);

  // Option 3: Push-to-Talk start/stop handlers (Keyboard Space + Orb Hold)
  const startPttHold = useCallback(() => {
    if (inputModeRef.current !== 'ptt' || isHoldingPttRef.current) return;
    // Interrupt AI if currently speaking
    if (statusRef.current === 'speaking') {
      if (typeof window !== 'undefined' && window.speechSynthesis) {
        window.speechSynthesis.cancel();
      }
      if (remoteAudioRef.current) {
        remoteAudioRef.current.pause();
      }
    }
    isAutoDuckedRef.current = false;
    setIsHoldingPtt(true);
    isHoldingPttRef.current = true;
    syncMicTrackState();
    setStatus('listening');
    setStatusText('در حال شنیدن (در حال نگه‌داشتن)...');

    if (
      isFallbackLiveRef.current &&
      mediaRecorderRef.current &&
      mediaRecorderRef.current.state === 'inactive'
    ) {
      try {
        mediaRecorderRef.current.start(200);
      } catch {}
    }
  }, [syncMicTrackState]);

  const stopPttHold = useCallback(() => {
    if (inputModeRef.current !== 'ptt' || !isHoldingPttRef.current) return;
    setIsHoldingPtt(false);
    isHoldingPttRef.current = false;
    syncMicTrackState();

    if (
      isFallbackLiveRef.current &&
      mediaRecorderRef.current &&
      mediaRecorderRef.current.state === 'recording'
    ) {
      try {
        mediaRecorderRef.current.stop();
      } catch {}
    } else {
      setStatusText('کلید Space یا گوی را برای صحبت نگه دارید');
    }
  }, [syncMicTrackState]);

  // Spacebar listener for Push-to-Talk when prompt drawer is closed
  useEffect(() => {
    if (!isOpen || isPromptDrawerOpen) return;

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Space' && inputModeRef.current === 'ptt' && !e.repeat) {
        e.preventDefault();
        startPttHold();
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space' && inputModeRef.current === 'ptt') {
        e.preventDefault();
        stopPttHold();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, [isOpen, isPromptDrawerOpen, startPttHold, stopPttHold]);

  const handleToggleInputMode = () => {
    const nextMode = inputMode === 'auto' ? 'ptt' : 'auto';
    setInputMode(nextMode);
    inputModeRef.current = nextMode;
    setIsHoldingPtt(false);
    isHoldingPttRef.current = false;
    syncMicTrackState();

    if (nextMode === 'ptt') {
      setStatusText('کلید Space یا گوی را برای صحبت نگه دارید');
    } else {
      setStatusText('در حال شنیدن...');
      if (isFallbackLiveRef.current && localStreamRef.current) {
        startSmartFallbackLiveVoice(localStreamRef.current);
      }
    }
  };

  const handleOrbTap = () => {
    if (inputMode === 'ptt') return;

    if (status === 'speaking') {
      if (typeof window !== 'undefined' && window.speechSynthesis) {
        window.speechSynthesis.cancel();
      }
      if (remoteAudioRef.current) {
        remoteAudioRef.current.pause();
      }
      isAutoDuckedRef.current = false;
      syncMicTrackState();
      setStatus('listening');
      setStatusText('در حال شنیدن...');
      return;
    }

    if (
      status === 'listening' &&
      mediaRecorderRef.current &&
      mediaRecorderRef.current.state === 'recording'
    ) {
      try {
        mediaRecorderRef.current.stop();
      } catch {}
    }
  };

  const handleToggleMute = () => {
    const nextMuted = !isMuted;
    setIsMuted(nextMuted);
    isMutedRef.current = nextMuted;
    syncMicTrackState();
  };

  const handleToggleSpeaker = () => {
    const nextSpeakerMuted = !isSpeakerMuted;
    setIsSpeakerMuted(nextSpeakerMuted);
    isSpeakerMutedRef.current = nextSpeakerMuted;
    if (remoteAudioRef.current) {
      remoteAudioRef.current.muted = nextSpeakerMuted;
    }
    if (nextSpeakerMuted && typeof window !== 'undefined' && window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }
  };

  // Apply custom System Prompt or send a Pre-Speech Message
  const handleSaveSystemPrompt = async (triggerPreMessage?: string) => {
    const trimmedSys = draftSystemPrompt.trim();
    setSystemPrompt(trimmedSys);
    systemPromptRef.current = trimmedSys;
    setIsPromptDrawerOpen(false);

    // Send session.update over WebRTC datachannel if open
    if (dcRef.current && dcRef.current.readyState === 'open') {
      try {
        dcRef.current.send(
          JSON.stringify({
            type: 'session.update',
            session: { instructions: [SABI_IDENTITY, trimmedSys].filter(Boolean).join('\n\n') },
          })
        );
      } catch {}
    }

    // Switch to context-aware smart voice engine when custom System Prompt or pre-message is used
    // so that custom instructions & pre-messages are 100% honored in every response
    if ((trimmedSys || triggerPreMessage) && !isFallbackLiveRef.current && localStreamRef.current) {
      startSmartFallbackLiveVoice(localStreamRef.current);
    }

    const msgToSend = (triggerPreMessage ?? preMessageInput).trim();
    if (msgToSend) {
      setPreMessageInput('');
      await processUserTurnAndRespond(msgToSend);
    }
  };

  if (!isOpen) return null;

  const activeSubtitle =
    status === 'speaking' && currentAssistantSpeech
      ? currentAssistantSpeech
      : currentUserSpeech || currentAssistantSpeech;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.25 }}
        role="dialog"
        aria-modal="true"
        aria-label="گفتگوی صوتی زنده"
        className="fixed inset-0 z-50 bg-zinc-50 dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100 flex flex-col justify-between select-none overflow-hidden"
      >
        <audio ref={remoteAudioRef} autoPlay playsInline className="hidden" />

        {/* Minimal Top Header matching the main app */}
        <header className="h-16 px-4 sm:px-8 flex items-center justify-between gap-2 z-20">
          <div className="flex items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400">
            <span className="w-2 h-2 rounded-full bg-zinc-900 dark:bg-zinc-100 animate-pulse" />
            <span className="font-medium text-zinc-700 dark:text-zinc-300">گفتگوی زنده</span>
            <span aria-hidden="true">·</span>
            <span dir="ltr" className="font-mono tabular-nums">
              {formatDuration(callSeconds)}
            </span>
          </div>

          <div className="flex items-center gap-2">
            {/* Option 3: Toggle Auto VAD vs Push-to-Talk */}
            <button
              type="button"
              onClick={handleToggleInputMode}
              title={
                inputMode === 'auto'
                  ? 'تغییر به حالت فشردن برای صحبت (مخصوص محیط شلوغ)'
                  : 'تغییر به حالت شنود خودکار'
              }
              className={`px-3 py-1.5 rounded-full text-xs font-medium flex items-center gap-1.5 border transition-colors cursor-pointer ${
                inputMode === 'ptt'
                  ? 'bg-zinc-900 text-zinc-50 dark:bg-zinc-100 dark:text-zinc-900 border-zinc-900 dark:border-zinc-100'
                  : 'bg-zinc-200/60 dark:bg-zinc-900 text-zinc-600 dark:text-zinc-400 border-zinc-300/60 dark:border-zinc-800 hover:text-zinc-900 dark:hover:text-zinc-200'
              }`}
            >
              {inputMode === 'ptt' ? (
                <>
                  <Hand className="w-3.5 h-3.5" />
                  <span>فشردن برای صحبت</span>
                </>
              ) : (
                <>
                  <Radio className="w-3.5 h-3.5" />
                  <span>شنود خودکار</span>
                </>
              )}
            </button>

            {/* System Prompt & Pre-Message Button */}
            <button
              type="button"
              onClick={() => {
                setDraftSystemPrompt(systemPrompt);
                setIsPromptDrawerOpen((prev) => !prev);
              }}
              title="تنظیم سیستم پرامپت یا ارسال پیام پیش‌زمینه"
              className={`px-3 py-1.5 rounded-full text-xs font-medium flex items-center gap-1.5 border transition-colors cursor-pointer ${
                systemPrompt.trim()
                  ? 'bg-zinc-900 text-zinc-50 dark:bg-zinc-100 dark:text-zinc-900 border-zinc-900 dark:border-zinc-100'
                  : 'bg-zinc-200/60 dark:bg-zinc-900 text-zinc-600 dark:text-zinc-400 border-zinc-300/60 dark:border-zinc-800 hover:text-zinc-900 dark:hover:text-zinc-200'
              }`}
            >
              <SlidersHorizontal className="w-3.5 h-3.5" />
              <span>دستورالعمل</span>
            </button>
          </div>
        </header>

        {/* Minimalist System Prompt & Pre-Speech Message Drawer */}
        <AnimatePresence>
          {isPromptDrawerOpen && (
            <motion.div
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.18 }}
              className="mx-auto w-full max-w-lg px-4 z-30"
            >
              <div className="rounded-3xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 p-4 shadow-xl space-y-3.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-zinc-800 dark:text-zinc-200">
                    سیستم پرامپت و پیام پیش‌فرض گفتگوی زنده
                  </span>
                  <button
                    type="button"
                    onClick={() => setIsPromptDrawerOpen(false)}
                    className="p-1 rounded-full text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 cursor-pointer"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>

                <div className="space-y-1.5">
                  <label className="block text-[11px] text-zinc-500 dark:text-zinc-400">
                    نقش یا دستورالعمل دائمی (System Prompt):
                  </label>
                  <textarea
                    rows={2}
                    value={draftSystemPrompt}
                    onChange={(e) => setDraftSystemPrompt(e.target.value)}
                    placeholder="مثلاً: تو یک مصاحبه‌گر فنی ارشد هستی و از من درباره پایتون سوال می‌پرسی..."
                    className="w-full rounded-2xl bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 px-3 py-2 text-xs text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 focus:outline-none resize-none leading-relaxed"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="block text-[11px] text-zinc-500 dark:text-zinc-400">
                    ارسال پیام متنی به هوش مصنوعی برای شروع یا هدایت صحبت:
                  </label>
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={preMessageInput}
                      onChange={(e) => setPreMessageInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && preMessageInput.trim()) {
                          e.preventDefault();
                          handleSaveSystemPrompt(preMessageInput);
                        }
                      }}
                      placeholder="مثلاً: سلام، مکالمه رو تو با یک سوال چالشی شروع کن..."
                      className="flex-1 rounded-2xl bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 px-3 py-2 text-xs text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 focus:outline-none"
                    />
                    <button
                      type="button"
                      onClick={() => handleSaveSystemPrompt(preMessageInput)}
                      className="px-3.5 py-2 rounded-2xl bg-zinc-900 dark:bg-zinc-100 text-zinc-50 dark:text-zinc-900 text-xs font-medium flex items-center gap-1.5 hover:opacity-90 cursor-pointer shrink-0"
                    >
                      <Send className="w-3.5 h-3.5" />
                      <span>اعمال</span>
                    </button>
                  </div>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Center: Signature Minimalist Breathing Sphere */}
        <div className="flex-1 flex flex-col items-center justify-center px-6 relative">
          <div className="relative flex items-center justify-center w-64 h-64 sm:w-72 sm:h-72">
            {/* Soft Outer Breathing Halo */}
            <motion.div
              animate={{
                scale:
                  status === 'speaking'
                    ? 1.05 + volumeLevel * 0.55
                    : status === 'thinking' || status === 'searching'
                    ? [0.95, 1.15, 0.95]
                    : 1 + volumeLevel * 0.65,
                opacity: status === 'speaking' ? 0.14 : isHoldingPtt ? 0.16 : 0.07,
              }}
              transition={{
                repeat:
                  status === 'thinking' || status === 'searching' ? Infinity : 0,
                duration: 2.2,
                ease: 'easeInOut',
              }}
              className="absolute inset-6 rounded-full bg-zinc-900 dark:bg-zinc-100 blur-2xl pointer-events-none"
            />

            {/* Outer Hairline Pulse Ring */}
            <motion.div
              animate={{
                scale: 0.98 + volumeLevel * 0.38,
                opacity: isHoldingPtt ? 0.65 : 0.35,
              }}
              transition={{
                type: 'spring',
                stiffness: 220,
                damping: 22,
              }}
              className="absolute w-48 h-48 sm:w-52 sm:h-52 rounded-full border border-zinc-300 dark:border-zinc-800 pointer-events-none"
            />

            {/* Inner Hairline Ring */}
            <motion.div
              animate={{
                scale: 1 + volumeLevel * 0.25,
              }}
              transition={{
                type: 'spring',
                stiffness: 240,
                damping: 20,
              }}
              className="absolute w-40 h-40 sm:w-44 sm:h-44 rounded-full border border-zinc-300/60 dark:border-zinc-800/80 pointer-events-none"
            />

            {/* Main Minimalist Monochrome Sphere */}
            <motion.button
              type="button"
              onClick={handleOrbTap}
              onMouseDown={() => {
                if (inputMode === 'ptt') startPttHold();
              }}
              onMouseUp={() => {
                if (inputMode === 'ptt') stopPttHold();
              }}
              onTouchStart={() => {
                if (inputMode === 'ptt') startPttHold();
              }}
              onTouchEnd={() => {
                if (inputMode === 'ptt') stopPttHold();
              }}
              aria-label="گوی صوتی — ضربه یا نگه‌داشتن برای تعامل"
              animate={{
                scale: 1 + volumeLevel * 0.28 + (isHoldingPtt ? 0.06 : 0),
              }}
              transition={{
                scale: { type: 'spring', stiffness: 260, damping: 20 },
              }}
              className="relative w-32 h-32 sm:w-36 sm:h-36 rounded-full bg-zinc-900 dark:bg-zinc-100 shadow-2xl flex items-center justify-center gap-1.5 cursor-pointer focus:outline-none"
            >
              {[0.55, 1, 0.85, 0.6].map((multiplier, idx) => (
                <motion.span
                  key={idx}
                  animate={{
                    height:
                      status === 'thinking' || status === 'searching'
                        ? [10, 18, 10]
                        : Math.max(
                            10,
                            Math.min(36, 10 + volumeLevel * 58 * multiplier)
                          ),
                  }}
                  transition={
                    status === 'thinking' || status === 'searching'
                      ? {
                          repeat: Infinity,
                          duration: 0.75 + idx * 0.12,
                          ease: 'easeInOut',
                        }
                      : { type: 'spring', stiffness: 300, damping: 18 }
                  }
                  className="w-1.5 rounded-full bg-zinc-50 dark:bg-zinc-950"
                />
              ))}
            </motion.button>
          </div>

          {/* Minimal Status & Live Word-by-Word Subtitle */}
          <div className="mt-6 text-center max-w-md space-y-2.5">
            <motion.p
              key={statusText + (isMuted ? '-muted' : '')}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              className="text-sm font-medium text-zinc-600 dark:text-zinc-400"
            >
              {isMuted ? 'میکروفون بی‌صدا است' : statusText}
            </motion.p>

            {systemPrompt.trim() && (
              <p className="text-[11px] text-zinc-400 dark:text-zinc-500 truncate max-w-xs mx-auto">
                نقش فعال: {systemPrompt}
              </p>
            )}

            {activeSubtitle && (
              <motion.p
                key={activeSubtitle.slice(-25)}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="text-sm sm:text-base font-normal text-zinc-800 dark:text-zinc-200 leading-relaxed line-clamp-3 px-2"
              >
                {activeSubtitle}
              </motion.p>
            )}
          </div>
        </div>

        {/* Minimal Bottom Controls matching the main UI */}
        <div className="pb-10 pt-4 px-6 flex items-center justify-center gap-6 z-20">
          {/* Mute / Unmute Mic */}
          <button
            type="button"
            onClick={handleToggleMute}
            aria-label={isMuted ? 'روشن کردن میکروفون' : 'بی‌صدا کردن میکروفون'}
            title={isMuted ? 'روشن کردن میکروفون' : 'بی‌صدا کردن میکروفون'}
            className={`w-14 h-14 rounded-full flex items-center justify-center transition-all cursor-pointer ${
              isMuted
                ? 'bg-red-500/15 text-red-500 border border-red-500/30'
                : 'bg-zinc-200/80 dark:bg-zinc-900 text-zinc-800 dark:text-zinc-200 hover:bg-zinc-300/80 dark:hover:bg-zinc-800 border border-zinc-300/60 dark:border-zinc-800'
            }`}
          >
            {isMuted ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
          </button>

          {/* End / Close Live Voice */}
          <button
            type="button"
            onClick={handleEndCall}
            aria-label="پایان گفتگوی زنده"
            title="پایان گفتگوی زنده"
            className="w-16 h-16 rounded-full bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 hover:opacity-90 flex items-center justify-center shadow-md transition-transform active:scale-95 cursor-pointer"
          >
            <X className="w-6 h-6" />
          </button>

          {/* Mute / Unmute Speaker */}
          <button
            type="button"
            onClick={handleToggleSpeaker}
            aria-label={isSpeakerMuted ? 'وصل صدای بلندگو' : 'قطع صدای بلندگو'}
            title={isSpeakerMuted ? 'وصل صدای بلندگو' : 'قطع صدای بلندگو'}
            className={`w-14 h-14 rounded-full flex items-center justify-center transition-all cursor-pointer ${
              isSpeakerMuted
                ? 'bg-amber-500/15 text-amber-500 border border-amber-500/30'
                : 'bg-zinc-200/80 dark:bg-zinc-900 text-zinc-800 dark:text-zinc-200 hover:bg-zinc-300/80 dark:hover:bg-zinc-800 border border-zinc-300/60 dark:border-zinc-800'
            }`}
          >
            {isSpeakerMuted ? (
              <VolumeX className="w-5 h-5" />
            ) : (
              <Volume2 className="w-5 h-5" />
            )}
          </button>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
