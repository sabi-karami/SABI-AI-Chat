import { NextRequest } from 'next/server';
import * as jsdomPkg from 'jsdom';
import sharp from 'sharp';
import { GoogleGenAI } from '@google/genai';
import { ProxyAgent, fetch as undiciFetch } from 'undici';
import { SABI_IDENTITY } from '@/lib/assistant-identity';
import {
  BASE_URL,
  DEFAULT_UA,
  IMG_MAX_DIM,
  IMG_WEBP_QUALITY,
  IMG_MAX_PAYLOAD,
  resolveModel,
  extractFeVersion,
  decodeChallengeHeader,
  buildProof,
  buildFeSignals,
  buildChatRequestBody,
  parseSseLine,
  SolvedChallenge,
  DuckHistoryMessage,
  DuckImagePart,
  ImageQualityTier,
  ImageAspectRatio,
  resolveImageDimensions,
  buildEnhancedDrawPrompt,
  getFallbackFreeDuckModel,
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

// Optional proxy for duck.ai egress — useful on hosts whose datacenter IP
// ranges are blocked by duck.ai at the network level (e.g. some clouds).
// Set DUCK_PROXY=http://user:pass@host:port (HTTP/HTTPS proxy).
const duckProxyUrl = (process.env.DUCK_PROXY || '').trim();
const duckDispatcher = duckProxyUrl ? new ProxyAgent(duckProxyUrl) : undefined;
if (duckDispatcher) {
  console.log('[duckchat] duck.ai requests routed via DUCK_PROXY');
}

function duckFetch(url: string, init: Record<string, unknown>): Promise<Response> {
  if (!duckDispatcher) return fetch(url, init as RequestInit) as Promise<Response>;
  return undiciFetch(url, {
    ...init,
    dispatcher: duckDispatcher,
  } as never) as unknown as Promise<Response>;
}

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

/**
 * Mirrors `image_to_data_url` in duck_cli.py using server-side `sharp` (equivalent to Pillow):
 * Ensures every uploaded image (even from iOS Safari / Android browsers where canvas.toDataURL
 * falls back to PNG/JPEG) is genuinely encoded as `image/webp` with white background,
 * max dimension 1568px, and stepped quality down if needed.
 */
async function normalizeImageToWebP(imgPart: DuckImagePart): Promise<DuckImagePart> {
  try {
    const rawStr = imgPart.image || '';
    const b64 = rawStr.includes(',') ? rawStr.split(',')[1] : rawStr;
    const inputBuf = Buffer.from(b64, 'base64');

    let q = IMG_WEBP_QUALITY;
    let outBuf = await sharp(inputBuf)
      .rotate()
      .flatten({ background: { r: 255, g: 255, b: 255 } })
      .resize(IMG_MAX_DIM, IMG_MAX_DIM, {
        fit: 'inside',
        withoutEnlargement: true,
      })
      .webp({ quality: q })
      .toBuffer();

    let dataUrl = `data:image/webp;base64,${outBuf.toString('base64')}`;
    while (dataUrl.length > IMG_MAX_PAYLOAD && q > 30) {
      q -= 15;
      outBuf = await sharp(inputBuf)
        .rotate()
        .flatten({ background: { r: 255, g: 255, b: 255 } })
        .resize(IMG_MAX_DIM, IMG_MAX_DIM, {
          fit: 'inside',
          withoutEnlargement: true,
        })
        .webp({ quality: q })
        .toBuffer();
      dataUrl = `data:image/webp;base64,${outBuf.toString('base64')}`;
    }

    return {
      type: 'image',
      mimeType: 'image/webp',
      image: dataUrl,
    };
  } catch {
    return imgPart;
  }
}

async function enhanceAndResizeGeneratedImage(
  rawB64: string,
  quality: ImageQualityTier = '2K',
  aspectRatio: ImageAspectRatio = '1:1'
): Promise<{
  b64: string;
  width: number;
  height: number;
  format: string;
  quality: ImageQualityTier;
  aspectRatio: ImageAspectRatio;
}> {
  const { width, height } = resolveImageDimensions(quality, aspectRatio);
  try {
    const cleanB64 = rawB64.includes(',') ? rawB64.split(',')[1] : rawB64;
    const inputBuf = Buffer.from(cleanB64, 'base64');

    const outBuf = await sharp(inputBuf)
      .resize(width, height, {
        kernel: sharp.kernel.lanczos3,
        fit: 'cover',
        position: 'attention',
      })
      .sharpen({
        sigma: quality === '4K' ? 1.15 : quality === '2K' ? 0.85 : 0.55,
        m1: 1.0,
        m2: 2.0,
      })
      .jpeg({
        quality: quality === '4K' ? 94 : 92,
        chromaSubsampling: '4:4:4',
        mozjpeg: true,
      })
      .toBuffer();

    return {
      b64: outBuf.toString('base64'),
      width,
      height,
      format: 'jpeg',
      quality,
      aspectRatio,
    };
  } catch {
    return {
      b64: rawB64,
      width,
      height,
      format: 'jpeg',
      quality,
      aspectRatio,
    };
  }
}

/**
 * Sanitizes conversation history so previous turns don't resend unvalidated raw base64 images
 * that would trigger 400/418 on follow-up turns.
 */
function sanitizeHistory(history: DuckHistoryMessage[]): DuckHistoryMessage[] {
  return (history || []).map((msg) => {
    if (msg.role === 'user' && Array.isArray(msg.content)) {
      const textParts = msg.content.filter((part) => part.type === 'text');
      return {
        role: 'user',
        content: textParts.length > 0 ? textParts : [{ type: 'text', text: '...' }],
      };
    }
    return {
      role: msg.role,
      content: typeof msg.content === 'string' ? msg.content : '',
    };
  });
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
    try {
      Object.defineProperty(w.navigator, 'userAgent', {
        get: () => ua,
        configurable: true,
      });
      Object.defineProperty(w.navigator, 'appVersion', {
        get: () => ua.replace('Mozilla/', ''),
        configurable: true,
      });
      Object.defineProperty(w.navigator, 'webdriver', {
        get: () => false,
        configurable: true,
      });
    } catch {
      // ignore read-only property errors
    }

    const proto = w.Element.prototype;
    for (const [prop, val] of [
      ['offsetWidth', 17],
      ['offsetHeight', 35],
      ['scrollHeight', 19],
      ['clientWidth', 17],
      ['clientHeight', 35],
    ] as const) {
      Object.defineProperty(proto, prop, {
        get() {
          return (this as any).__fake || val;
        },
        configurable: true,
      });
    }
    proto.getBoundingClientRect = function () {
      return {
        width: 17,
        height: 35,
        top: 0,
        left: 0,
        right: 17,
        bottom: 35,
        x: 0,
        y: 0,
      };
    };

    const result = (await w.eval(jsSource)) as SolvedChallenge;
    if (!result || result.__error) {
      throw new Error(result?.__error || 'Empty solver result');
    }
    return result;
  } finally {
    try {
      w.close();
    } catch {
      // ignore close errors
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

    const bootRes = await duckFetch(`${BASE_URL}/`, {
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
    const statusRes = await duckFetch(`${BASE_URL}/duckchat/v1/status`, {
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
  const encoder = new TextEncoder();

  let body: {
    prompt?: string;
    model?: string;
    history?: DuckHistoryMessage[];
    images?: DuckImagePart[];
    draw?: boolean;
    imageQuality?: ImageQualityTier;
    imageAspectRatio?: ImageAspectRatio;
    promptExtra?: string;
  };

  try {
    body = await req.json();
  } catch {
    return new Response(
      JSON.stringify({ error: 'درخواست نامعتبر است' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    );
  }

  const prompt = (body.prompt || '').trim();
  const model = resolveModel(body.model);
  const cleanHistory = sanitizeHistory(body.history || []);
  const rawImages = body.images || [];
  const draw = Boolean(body.draw);
  const imageQuality: ImageQualityTier = body.imageQuality || '2K';
  const imageAspectRatio: ImageAspectRatio = body.imageAspectRatio || '1:1';
  const promptExtra = body.promptExtra || '';

  if (!prompt && rawImages.length === 0 && !promptExtra) {
    return new Response(
      JSON.stringify({ error: 'متن پیام یا پیوست نمی‌تواند خالی باشد' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    );
  }

  // Duck.ai applies its own higher-priority identity on some models. Answer only
  // simple, standalone product-name questions here; all other requests still
  // go to the selected model as usual.
  const identityQuestion = prompt
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\u200c\u200d]/g, ' ')
    .replace(/[؟?!.,،؛:]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const asksProductName = /^(?:سلام )?(?:(?:اسم(?:ت| تو| شما)?|نام(?:ت| تو| شما)?) (?:چیه|چیست|چی|چه نامی است)|(?:تو|شما) (?:کی|چه کسی) (?:هستی|هستید)|خودت(?: رو| را)?(?: به فارسی)? معرفی کن|خودتون(?: رو| را)?(?: به فارسی)? معرفی کنید|what(?:'s| is) your name|who are you|introduce yourself)(?: کوتاه جواب بده)?$/.test(identityQuestion);
  if (asksProductName && !draw && rawImages.length === 0 && !promptExtra) {
    return new Response(
      JSON.stringify({ kind: 'message', value: 'من SABI-AI هستم؛ دستیار هوش مصنوعی شما. چطور می‌توانم کمکتان کنم؟' }) + '\n' +
        JSON.stringify({ kind: 'done' }) + '\n',
      { headers: { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-cache, no-transform' } }
    );
  }

  const stream = new ReadableStream({
    async start(controller) {
      const sendEvent = (ev: Record<string, unknown>) => {
        controller.enqueue(encoder.encode(JSON.stringify(ev) + '\n'));
      };

      // Convert all uploaded images to genuine WebP via sharp (matching Pillow in duck_cli.py)
      const normalizedImages: DuckImagePart[] = [];
      for (const img of rawImages) {
        normalizedImages.push(await normalizeImageToWebP(img));
      }

      let succeededViaDuckAi = false;
      let lastDuckError = '';

      try {
        const retries = 4;
        let chatRes: Response | null = null;

        let activeDuckModel = model;

        for (let attempt = 0; attempt < retries; attempt++) {
          // Exact duck_cli.py handshake reuse rule:
          // Only rehandshake on retry (attempt > 0) or if feVersion/jsa are not yet initialized
          if (attempt > 0 || !sessionCache.feVersion || !sessionCache.jsa) {
            await performRehandshake(DEFAULT_UA);
          }

          // Keep image-generation prompts focused on the image itself.
          const effectivePromptForModel = draw
            ? buildEnhancedDrawPrompt(prompt, imageQuality, imageAspectRatio)
            : `[Assistant identity: ${SABI_IDENTITY}]\n\n${prompt}`;

          const requestPayload = buildChatRequestBody({
            prompt: effectivePromptForModel,
            model: activeDuckModel,
            tools: true,
            history: cleanHistory,
            images: normalizedImages,
            draw,
            promptExtra,
          });

          const cookieHeader = formatCookieHeader(sessionCache.cookies);
          chatRes = await duckFetch(`${BASE_URL}/duckchat/v1/chat`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Accept: 'text/event-stream',
              Origin: BASE_URL,
              Referer: `${BASE_URL}/`,
              'User-Agent': DEFAULT_UA,
              'Accept-Language': 'en-US,en;q=0.9',
              'x-fe-version': sessionCache.feVersion,
              'x-fe-signals': buildFeSignals(),
              'X-Vqd-Hash-1': sessionCache.jsa,
              ...(cookieHeader ? { Cookie: cookieHeader } : {}),
            },
            body: JSON.stringify(requestPayload),
            signal: AbortSignal.timeout(45_000),
          });

          updateCookiesFromHeaders(chatRes.headers, sessionCache.cookies);

          const nextRawChallenge = chatRes.headers.get('x-vqd-hash-1');
          if (nextRawChallenge) {
            try {
              const nextJs = decodeChallengeHeader(nextRawChallenge);
              const nextSolved = await solveChallengeJs(nextJs, DEFAULT_UA);
              sessionCache.jsa = buildProof(nextSolved);
              sessionCache.lastUpdated = Date.now();
            } catch {
              // ignore
            }
          }

          if (chatRes.status === 200 && chatRes.body) {
            break;
          }
          lastDuckError = `Chat HTTP ${chatRes.status}`;

          // If a Plus/Pro/deprecated model was rejected (e.g. 400/401/403/418), switch to its official Duck.ai free equivalent
          const fallbackModel = getFallbackFreeDuckModel(activeDuckModel);
          if (fallbackModel && fallbackModel !== activeDuckModel) {
            activeDuckModel = fallbackModel;
          }

          if (!nextRawChallenge) {
            sessionCache.jsa = '';
          }

          await new Promise((r) => setTimeout(r, (1 + attempt) * 1000));
        }

        if (chatRes && chatRes.status === 200 && chatRes.body) {
          const reader = chatRes.body.getReader();
          const decoder = new TextDecoder();
          let buffer = '';
          let emittedAny = false;

          while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';

            for (const rawLine of lines) {
              const parsed = parseSseLine(rawLine);
              if (!parsed) continue;
              if (parsed.kind === 'error') {
                throw new Error(parsed.value);
              }
              if (parsed.kind === 'image') {
                const enhanced = await enhanceAndResizeGeneratedImage(
                  parsed.value.b64,
                  imageQuality,
                  imageAspectRatio
                );
                emittedAny = true;
                sendEvent({ kind: 'image', value: enhanced });
                continue;
              }
              emittedAny = true;
              sendEvent(parsed);
            }
          }

          if (buffer.trim()) {
            const parsed = parseSseLine(buffer);
            if (parsed && parsed.kind !== 'error') {
              if (parsed.kind === 'image') {
                const enhanced = await enhanceAndResizeGeneratedImage(
                  parsed.value.b64,
                  imageQuality,
                  imageAspectRatio
                );
                emittedAny = true;
                sendEvent({ kind: 'image', value: enhanced });
              } else {
                emittedAny = true;
                sendEvent(parsed);
              }
            }
          }

          if (emittedAny) {
            succeededViaDuckAi = true;
          }
        }
      } catch (e) {
        lastDuckError = e instanceof Error ? e.message : String(e);
        const cause = (e as any)?.cause;
        if (cause) lastDuckError += ` (${cause.code || cause.message || cause})`;
        console.error('[duckchat] duck.ai failed:', lastDuckError, cause || '');
        // Fallback if duck.ai returns an error after retries
      }

      if (!succeededViaDuckAi) {
        const geminiKey = process.env.GEMINI_API_KEY;
        if (geminiKey && geminiKey !== 'MY_GEMINI_API_KEY') {
          try {
            const ai = new GoogleGenAI({ apiKey: geminiKey });
            if (draw) {
              const imgRes = await ai.models.generateContent({
                model: 'gemini-2.5-flash-image',
                contents: buildEnhancedDrawPrompt(
                  prompt || 'A beautiful artistic illustration',
                  imageQuality,
                  imageAspectRatio
                ),
              });
              const candidateParts = imgRes.candidates?.[0]?.content?.parts || [];
              for (const part of candidateParts) {
                if (part.inlineData?.data) {
                  const enhanced = await enhanceAndResizeGeneratedImage(
                    part.inlineData.data,
                    imageQuality,
                    imageAspectRatio
                  );
                  sendEvent({
                    kind: 'image',
                    value: enhanced,
                  });
                  succeededViaDuckAi = true;
                } else if (part.text) {
                  sendEvent({ kind: 'message', value: part.text });
                  succeededViaDuckAi = true;
                }
              }
            } else {
              const parts: any[] = [];
              for (const img of normalizedImages) {
                const b64Data = img.image.split(',')[1] || '';
                if (b64Data) {
                  parts.push({
                    inlineData: {
                      mimeType: 'image/webp',
                      data: b64Data,
                    },
                  });
                }
              }
              parts.push({
                text: `[Assistant identity: ${SABI_IDENTITY}]\n\n${prompt}${promptExtra}`,
              });
              const res = await ai.models.generateContent({
                model: 'gemini-2.5-flash',
                contents: [{ role: 'user', parts }],
              });
              const text = res.text || '';
              if (text) {
                sendEvent({ kind: 'message', value: text });
                succeededViaDuckAi = true;
              }
            }
          } catch {
            // ignore
          }
        }

        if (!succeededViaDuckAi) {
          console.error('[duckchat] final failure:', lastDuckError || 'unknown');
          sendEvent({
            kind: 'error',
            value: `سرور در حال حاضر پاسخگو نیست. لطفاً چند لحظه دیگر دوباره امتحان کنید.${lastDuckError ? ` [${lastDuckError}]` : ''}`,
          });
        }
      }

      sendEvent({ kind: 'done' });
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  });
}
