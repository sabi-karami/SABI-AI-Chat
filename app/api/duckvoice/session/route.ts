import { NextRequest, NextResponse } from 'next/server';
import * as jsdomPkg from 'jsdom';
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

export async function GET(req: NextRequest) {
  try {
    if (!sessionCache.feVersion || !sessionCache.jsa || Date.now() - sessionCache.lastUpdated > 180_000) {
      await performRehandshake();
    }
    const journeyId =
      req.nextUrl.searchParams.get('journeyId') ||
      Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);

    const cookieHeader = formatCookieHeader(sessionCache.cookies);
    const iceRes = await fetch(`${BASE_URL}/duckchat/v1/ice-servers`, {
      headers: {
        'x-fe-version': sessionCache.feVersion,
        'x-ddg-journey-id': journeyId,
        'x-fe-signals': buildFeSignals(),
        Referer: `${BASE_URL}/`,
        'User-Agent': DEFAULT_UA,
        ...(cookieHeader ? { Cookie: cookieHeader } : {}),
      },
      signal: AbortSignal.timeout(12_000),
    });
    updateCookiesFromHeaders(iceRes.headers, sessionCache.cookies);

    if (iceRes.ok) {
      const data = await iceRes.json();
      return NextResponse.json({
        success: true,
        iceServers: data.iceServers || [],
        journeyId,
      });
    }

    return NextResponse.json({
      success: true,
      iceServers: [
        { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
      ],
      journeyId,
    });
  } catch {
    return NextResponse.json({
      success: true,
      iceServers: [
        { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
      ],
      journeyId: Math.random().toString(36).slice(2),
    });
  }
}

export async function POST(req: NextRequest) {
  try {
    const { sdp, voice = 'voice-1', journeyId } = await req.json();

    if (!sdp) {
      return NextResponse.json({ error: 'Missing SDP offer' }, { status: 400 });
    }

    const effectiveJourneyId =
      journeyId || Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);

    for (let attempt = 0; attempt < 3; attempt++) {
      if (!sessionCache.feVersion || !sessionCache.jsa || attempt > 0) {
        await performRehandshake();
      }

      const voiceSignals = Buffer.from(
        JSON.stringify({
          start: Date.now(),
          events: [{ name: 'startVoiceSession_free', delta: 119, trusted: true }],
          end: 1500,
        })
      ).toString('base64');

      const cookieHeader = formatCookieHeader(sessionCache.cookies);

      const sessRes = await fetch(`${BASE_URL}/duckchat/v1/session`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Origin: BASE_URL,
          Referer: `${BASE_URL}/`,
          'x-fe-version': sessionCache.feVersion,
          'x-vqd-hash-1': sessionCache.jsa,
          'x-fe-signals': voiceSignals,
          'x-ddg-journey-id': effectiveJourneyId,
          ...(cookieHeader ? { Cookie: cookieHeader } : {}),
          'User-Agent': DEFAULT_UA,
        },
        body: JSON.stringify({
          sdp,
          session: { voice },
        }),
        signal: AbortSignal.timeout(20_000),
      });

      updateCookiesFromHeaders(sessRes.headers, sessionCache.cookies);

      if (sessRes.status === 200) {
        const answerSdp = await sessRes.text();
        return NextResponse.json({
          success: true,
          answerSdp,
          voice,
        });
      }

      if (sessRes.status === 418 || sessRes.status === 403) {
        sessionCache.jsa = '';
        await new Promise((r) => setTimeout(r, 1000 + attempt * 1000));
        continue;
      }

      break;
    }

    return NextResponse.json(
      {
        success: false,
        fallbackMode: 'ai_simulated',
        message: 'اتصال مستقیم WebRTC سرور در دسترس نبود؛ حالت زنده هوشمند فعال شد.',
      },
      { status: 200 }
    );
  } catch (err: any) {
    return NextResponse.json(
      {
        success: false,
        fallbackMode: 'ai_simulated',
        error: err?.message || 'خطا در برقراری جلسه صوتی',
      },
      { status: 200 }
    );
  }
}
