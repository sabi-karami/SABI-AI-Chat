import { NextRequest, NextResponse } from 'next/server';
import * as jsdomPkg from 'jsdom';
import { GoogleGenAI } from '@google/genai';
import {
  BASE_URL,
  DEFAULT_UA,
  extractFeVersion,
  decodeChallengeHeader,
  buildProof,
  buildFeSignals,
  SolvedChallenge,
} from '@/lib/duck-protocol';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface SessionState {
  feVersion: string;
  jsa: string;
  cookies: Map<string, string>;
  lastUpdated: number;
}

const sessionCache: SessionState = {
  feVersion: '',
  jsa: '',
  cookies: new Map(),
  lastUpdated: 0,
};

let inFlightHandshake: Promise<{ feVersion: string; jsa: string }> | null = null;

function updateCookiesFromHeaders(headers: Headers, cookieMap: Map<string, string>) {
  const setCookies =
    typeof (headers as any).getSetCookie === 'function'
      ? (headers as any).getSetCookie()
      : headers.get('set-cookie')
      ? [headers.get('set-cookie')!]
      : [];
  for (const raw of setCookies) {
    if (!raw) continue;
    const firstPart = raw.split(';')[0];
    const eqIdx = firstPart.indexOf('=');
    if (eqIdx > 0) {
      const k = firstPart.slice(0, eqIdx).trim();
      const v = firstPart.slice(eqIdx + 1).trim();
      cookieMap.set(k, v);
    }
  }
}

function formatCookieHeader(cookieMap: Map<string, string>): string {
  return Array.from(cookieMap.entries())
    .map(([k, v]) => `${k}=${v}`)
    .join('; ');
}

async function solveChallengeJs(jsSource: string, ua = DEFAULT_UA): Promise<SolvedChallenge> {
  const JSDOM = (jsdomPkg as any).JSDOM;
  const dom = new JSDOM(
    '<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; script-src \'unsafe-inline\';"></head><body><iframe id="jsa" sandbox="allow-scripts allow-same-origin"></iframe></body></html>',
    {
      url: 'https://duck.ai/',
      userAgent: ua,
      runScripts: 'outside-only',
      pretendToBeVisual: true,
    }
  );
  const w = dom.window;
  try {
    w.__DDG_BE_VERSION__ = '1';
    w.__DDG_FE_CHAT_HASH__ = '1';
    const jsaIframe = w.document.querySelector('#jsa');
    if (jsaIframe && jsaIframe.contentDocument && jsaIframe.contentDocument.head) {
      jsaIframe.contentDocument.head.innerHTML =
        '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; script-src \'unsafe-inline\';">';
    }
    const result = (await w.eval(jsSource)) as SolvedChallenge;
    if (!result || result.__error) {
      throw new Error(result?.__error || 'Empty solver result');
    }
    return result;
  } finally {
    try {
      w.close();
    } catch {
      // ignore
    }
  }
}

async function performRehandshake(ua = DEFAULT_UA): Promise<{
  feVersion: string;
  jsa: string;
}> {
  if (inFlightHandshake) {
    return inFlightHandshake;
  }

  inFlightHandshake = (async () => {
    const commonHeaders: Record<string, string> = {
      'User-Agent': ua,
      'Accept-Language': 'en-US,en;q=0.9',
    };

    const bootRes = await fetch(`${BASE_URL}/`, {
      headers: commonHeaders,
      cache: 'no-store',
      signal: AbortSignal.timeout(15_000),
    });
    if (!bootRes.ok) {
      throw new Error(`Bootstrap HTTP ${bootRes.status}`);
    }
    updateCookiesFromHeaders(bootRes.headers, sessionCache.cookies);
    const html = await bootRes.text();
    sessionCache.feVersion = extractFeVersion(html);

    const cookieHeader = formatCookieHeader(sessionCache.cookies);
    const statusRes = await fetch(`${BASE_URL}/duckchat/v1/status`, {
      headers: {
        ...commonHeaders,
        'x-vqd-accept': '1',
        'Cache-Control': 'no-store',
        'x-fe-version': sessionCache.feVersion,
        Origin: BASE_URL,
        Referer: `${BASE_URL}/`,
        ...(cookieHeader ? { Cookie: cookieHeader } : {}),
      },
      cache: 'no-store',
      signal: AbortSignal.timeout(15_000),
    });
    updateCookiesFromHeaders(statusRes.headers, sessionCache.cookies);

    const rawChallenge = statusRes.headers.get('x-vqd-hash-1');
    if (!rawChallenge) {
      throw new Error(`Challenge HTTP ${statusRes.status}`);
    }

    const jsSource = decodeChallengeHeader(rawChallenge);
    const solved = await solveChallengeJs(jsSource, ua);
    const jsa = buildProof(solved);

    sessionCache.jsa = jsa;
    sessionCache.lastUpdated = Date.now();
    return { feVersion: sessionCache.feVersion, jsa };
  })();

  try {
    return await inFlightHandshake;
  } finally {
    inFlightHandshake = null;
  }
}

export async function POST(req: NextRequest) {
  try {
    const arrayBuffer = await req.arrayBuffer();
    const audioBuffer = Buffer.from(arrayBuffer);

    if (audioBuffer.length < 100) {
      return NextResponse.json({ error: 'Audio data too short' }, { status: 400 });
    }

    const model = req.headers.get('x-model') || 'gpt-6-luna';

    // 1. First attempt: duck.ai /duckchat/v1/dictation (native protocol)
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        if (!sessionCache.feVersion || !sessionCache.jsa || attempt > 0) {
          await performRehandshake();
        }

        const cookieHeader = formatCookieHeader(sessionCache.cookies);
        const dictRes = await fetch(`${BASE_URL}/duckchat/v1/dictation`, {
          method: 'POST',
          headers: {
            'Content-Type': 'audio/webm',
            'x-duckai-chat-model': model,
            'x-fe-version': sessionCache.feVersion,
            'x-vqd-hash-1': sessionCache.jsa,
            'x-fe-signals': buildFeSignals(),
            Origin: BASE_URL,
            Referer: `${BASE_URL}/`,
            ...(cookieHeader ? { Cookie: cookieHeader } : {}),
            'User-Agent': DEFAULT_UA,
          },
          body: audioBuffer,
          signal: AbortSignal.timeout(20_000),
        });

        updateCookiesFromHeaders(dictRes.headers, sessionCache.cookies);

        if (dictRes.status === 200) {
          const json = await dictRes.json();
          if (json.action === 'success' && typeof json.text === 'string') {
            return NextResponse.json({
              success: true,
              text: json.text.trim(),
            });
          }
        }
      } catch {
        // Retry or fallback
      }
    }

    // 2. Intelligent Fallback: Gemini multimodal audio transcription
    const geminiKey = process.env.GEMINI_API_KEY;
    if (geminiKey && geminiKey !== 'MY_GEMINI_API_KEY') {
      try {
        const ai = new GoogleGenAI({ apiKey: geminiKey });
        const res = await ai.models.generateContent({
          model: 'gemini-2.5-flash',
          contents: [
            {
              role: 'user',
              parts: [
                {
                  inlineData: {
                    mimeType: 'audio/webm',
                    data: audioBuffer.toString('base64'),
                  },
                },
                {
                  text: 'این فایل صوتی را به صورت دقیق، روان و به زبان اصلی گوینده (فارسی/انگلیسی) رونویسی کن. هیچ توضیح، سلام، یا متن اضافه‌ای ننویس، فقط کلمات دقیق گوینده را بنویس.',
                },
              ],
            },
          ],
        });
        const text = (res.text || '').trim();
        if (text) {
          return NextResponse.json({
            success: true,
            text,
          });
        }
      } catch {
        // Fallback failed
      }
    }

    return NextResponse.json(
      { success: false, error: 'تبدیل صدا ناموفق بود. لطفاً دوباره صحبت کنید.' },
      { status: 500 }
    );
  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: err?.message || 'خطا در پردازش صدا' },
      { status: 500 }
    );
  }
}
