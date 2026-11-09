# duck_voice.py — قابلیت ویس برای duck_cli.py — نوامبر ۲۰۲۶
#
# دو حالت (ریورس‌شده از HAR واقعی + چانک chunk.voice-session.js):
#
# ۱) دیکته (voice → text):
#    POST /duckchat/v1/dictation
#      هدرها: Content-Type: audio/webm، x-vqd-hash-1 (proof jsa)،
#             x-fe-version، x-duckai-chat-model، x-fe-signals
#      بدنه: فایل webm/opus خام
#      پاسخ: {"action":"success","text":"سلام، خوبی؟ چکار میکنی؟"}
#
# ۲) ویس زنده (Realtime WebRTC) — همان کاری که مرورگر می‌کند:
#    GET  /duckchat/v1/ice-servers → TURN سرور
#    RTCPeerConnection (iceServers + datachannel «duckai-voice-session»)
#    POST /duckchat/v1/session  body: {"sdp": <offer>, "session": {"voice": "voice-1"}}
#         پاسخ: answer SDP (ice-lite، صدا Opus دوطرفه + datachannel)
#    صدا از میکروفون روی RTP می‌رود؛ رویدادها روی datachannel برمی‌گردند:
#      input_audio_buffer.speech_started/stopped
#      conversation.item.input_audio_transcription.completed → متن گفته شما
#      response.output_audio_transcript.delta → متن استریمی پاسخ
#      response.output_item.done → متن نهایی پاسخ
#      output_audio_buffer.started/stopped/cleared → پخش/پایان صدای assistant
#      response.done → وضعیت نهایی (completed/cancelled/failed)
#    کلاینت چیزی روی datachannel نمی‌فرستد (VAD سمت سرور است).
#
# پیش‌نیازها:  pip install sounddevice aiortc av numpy
# نکته: برای ویس زنده هندزفری بزنید تا اکوی بلندگو وارد میکروفون نشود.

import asyncio
import base64
import io
import json
import os
import queue
import sys
import threading
import time
import uuid
from fractions import Fraction

from duck_cli import DuckAI, DuckAIError, b64_json

_BASE = "https://duck.ai"

try:
    import numpy as np
    HAS_NUMPY = True
except ImportError:
    HAS_NUMPY = False

try:
    import sounddevice as sd
    HAS_SD = True
except Exception:
    HAS_SD = False

try:
    import av
    HAS_AV = True
except ImportError:
    HAS_AV = False

try:
    import aiortc
    from aiortc import (RTCConfiguration, RTCIceServer, RTCPeerConnection,
                        RTCSessionDescription)
    from aiortc.mediastreams import AudioStreamTrack
    HAS_AIORTC = True
except Exception:
    HAS_AIORTC = False


def deps_report() -> str:
    rows = [("numpy", HAS_NUMPY), ("sounddevice (میکروفون)", HAS_SD),
            ("av/PyAV (کدک Opus)", HAS_AV), ("aiortc (WebRTC)", HAS_AIORTC)]
    return " | ".join(f"{'✔' if ok else '✘'} {name}" for name, ok in rows)


def ensure_voice_deps(need_mic: bool = True, need_live: bool = False):
    missing = []
    if need_mic and not HAS_SD:
        missing.append("sounddevice")
    if not HAS_AV:
        missing.append("av")
    if need_live and not HAS_AIORTC:
        missing.append("aiortc")
    if missing:
        raise DuckAIError(
            "پکیج‌های ویس نصب نیستند: " + ", ".join(missing) +
            "  →  pip install " + " ".join(missing))


# ────────────────────────── تبدیل و ضبط صدا ──────────────────────────

def is_webm(data: bytes) -> bool:
    return data[:4] == b"\x1aE\xdf\xa3"


def resample_to_stereo48k(frames_iter, in_rate=None, in_layout="mono"):
    """هر ورودی صوتی av را به s16/stereo/48000 تبدیل می‌کند."""
    resampler = av.AudioResampler(format="s16", layout="stereo", rate=48000)
    for frame in frames_iter:
        for out in resampler.resample(frame):
            yield out


def audio_file_to_webm(path: str, max_seconds: float = 120.0) -> bytes:
    """فایل صوتی دلخواه (wav/mp3/m4a/...) را به webm/opus 48k تبدیل می‌کند."""
    if not HAS_AV:
        raise DuckAIError("PyAV نصب نیست → pip install av")
    try:
        src = av.open(path)
    except Exception as e:
        raise DuckAIError(f"بازکردن فایل صوتی ناموفق ({path}): {e}")
    astream = next((s for s in src.streams if s.type == "audio"), None)
    if astream is None:
        src.close()
        raise DuckAIError(f"در «{path}» استریم صوتی پیدا نشد.")
    astream.thread_type = "AUTO"
    buf = io.BytesIO()
    out = av.open(buf, "w", format="webm")
    st = out.add_stream("libopus", rate=48000)
    st.layout = "stereo"
    st.bit_rate = 32000
    pts = 0
    try:
        for frame in resample_to_stereo48k(src.decode(astream)):
            frame.pts = pts
            frame.time_base = Fraction(1, 48000)
            pts += frame.samples
            for pkt in st.encode(frame):
                out.mux(pkt)
            if pts / 48000 > max_seconds:
                break
        for pkt in st.encode(None):
            out.mux(pkt)
        out.close()
    finally:
        src.close()
    return buf.getvalue()


def record_to_webm(max_seconds: float = 30.0, stop_event: threading.Event = None,
                   samplerate: int = 48000) -> bytes:
    """ضبط از میکروفون تا Enter/توقف یا سقف زمانی؛ خروجی webm/opus."""
    if not HAS_SD:
        raise DuckAIError("sounddevice نصب نیست → pip install sounddevice")
    if not HAS_AV:
        raise DuckAIError("PyAV نصب نیست → pip install av")
    try:
        import numpy as np
    except ImportError:
        raise DuckAIError("numpy نصب نیست → pip install numpy")

    chunks: list = []
    ev = stop_event or threading.Event()

    def callback(indata, frames, time_info, status):
        chunks.append(indata.copy())

    print(f"  🎙 در حال ضبط… (Enter = پایان، حداکثر {int(max_seconds)} ثانیه)", flush=True)
    try:
        with sd.InputStream(samplerate=samplerate, channels=1, dtype="int16",
                            blocksize=960, callback=callback):
            t0 = time.monotonic()
            while not ev.is_set() and time.monotonic() - t0 < max_seconds:
                time.sleep(0.05)
    except Exception as e:
        raise DuckAIError(f"دسترسی به میکروفون ناموفق: {e}")

    if not chunks:
        raise DuckAIError("صدایی ضبط نشد — میکروفون را چک کنید.")
    pcm = np.concatenate(chunks, axis=0)          # (N,1) int16
    if pcm.shape[0] < samplerate // 5:
        raise DuckAIError("ضبط خیلی کوتاه بود (<۰.۲ ثانیه).")

    # int16 (N,1) → planar mono frame → resample به stereo 48k → webm/opus
    mono = pcm.reshape(1, -1)
    src_frame = av.AudioFrame.from_ndarray(mono, format="s16", layout="mono")
    src_frame.sample_rate = samplerate
    buf = io.BytesIO()
    out = av.open(buf, "w", format="webm")
    st = out.add_stream("libopus", rate=48000)
    st.layout = "stereo"
    st.bit_rate = 32000
    pts = 0
    resampler = av.AudioResampler(format="s16", layout="stereo", rate=48000)
    try:
        for of in resampler.resample(src_frame):
            of.pts = pts
            of.time_base = Fraction(1, 48000)
            pts += of.samples
            for pkt in st.encode(of):
                out.mux(pkt)
        for pkt in st.encode(None):
            out.mux(pkt)
        out.close()
    finally:
        pass
    return buf.getvalue()


# ────────────────────────── دیکته (voice → text) ──────────────────────────

def _fe_signals():
    return b64_json({"start": int(time.time() * 1000), "events": [],
                     "end": int(1500 + time.time() % 5000)})


def transcribe_bytes(client: DuckAI, webm_data: bytes, model: str) -> str:
    """ارسال webm/opus به اندپوینت dictation و گرفتن متن."""
    client.rehandshake() if not (client.fe_version and client.jsa) else None
    headers = {
        "Content-Type": "audio/webm",
        "x-duckai-chat-model": model,
        "x-fe-version": client.fe_version,
        "x-vqd-hash-1": client.jsa,
        "x-fe-signals": _fe_signals(),
        "Origin": _BASE,
        "Referer": _BASE + "/",
    }
    last_err = ""
    for attempt in range(3):
        r = client.s.post(_BASE + "/duckchat/v1/dictation",
                          headers=headers, data=webm_data, timeout=60)
        if r.status_code == 200:
            try:
                j = r.json()
            except Exception:
                raise DuckAIError(f"پاسخ دیکته قابل خواندن نبود: {r.text[:200]}")
            if j.get("action") == "success":
                return j.get("text", "")
            raise DuckAIError(f"دیکته ناموفق: {json.dumps(j, ensure_ascii=False)[:300]}")
        last_err = f"HTTP {r.status_code}: {r.text[:200]}"
        if r.status_code in (403, 418):
            client.rehandshake()
            headers["x-vqd-hash-1"] = client.jsa
            headers["x-fe-version"] = client.fe_version
            continue
        break
    raise DuckAIError(f"دیکته پس از تلاش ناموفق بود: {last_err}")


def transcribe_file(client: DuckAI, path: str, model: str) -> str:
    with open(path, "rb") as fh:
        data = fh.read()
    if not is_webm(data):
        data = audio_file_to_webm(path)
    return transcribe_bytes(client, data, model)


def record_and_transcribe(client: DuckAI, model: str,
                          max_seconds: float = 30.0) -> str:
    data = record_to_webm(max_seconds=max_seconds)
    print(f"  ✔ ضبط شد ({len(data) // 1024} KB) — در حال تبدیل به متن…", flush=True)
    return transcribe_bytes(client, data, model)


# ────────────────────────── ویس زنده (WebRTC) ──────────────────────────

try:
    import numpy as _np
except ImportError:
    _np = None


class _PacedAudioSource(AudioStreamTrack):
    """منبع صوتی 48k/مونو با پِیس ۱۰ms — از میکروفون یا فایل تغذیه می‌شود."""

    BLOCK = 960   # 20ms در 48kHz — aiortc برای Opus فریم ۹۶۰نمونه‌ای لازم دارد

    def __init__(self, feed: "queue.Queue", source_kind: str = "mic"):
        super().__init__()
        self._feed = feed
        self.source_kind = source_kind
        self._pts = 0
        self._next = time.monotonic()
        self._buf = _np.zeros(0, dtype="int16")
        self.muted = False          # وقتی assistant حرف می‌زند میکروفون قطع می‌شود
        self._sent_muted = 0

    async def recv(self):
        # پِیس‌گذاری ۱۰ms و بلاک ثابت ۴۸۰نمونه‌ای (مهم برای VAD سمت سرور)
        while len(self._buf) < self.BLOCK:
            block = await asyncio.get_event_loop().run_in_executor(
                None, self._feed.get)
            if block.ndim == 2:
                block = block.reshape(-1)
            if self.muted:
                self._sent_muted += 1
                block = _np.zeros_like(block)
            self._buf = _np.concatenate([self._buf, block]) if len(self._buf)                 else block
        out, self._buf = self._buf[:self.BLOCK], self._buf[self.BLOCK:]
        self._next += 0.02
        wait = self._next - time.monotonic()
        if wait > 0:
            await asyncio.sleep(wait)
        else:
            self._next = time.monotonic()
        frame = av.AudioFrame.from_ndarray(out.reshape(1, -1), format="s16",
                                           layout="mono")
        frame.sample_rate = 48000
        frame.pts = self._pts
        frame.time_base = Fraction(1, 48000)
        self._pts += self.BLOCK
        return frame


class _Player:
    """پخش صدای دریافتی از assistant روی بلندگو."""

    def __init__(self, samplerate: int = 48000):
        self.q: "queue.Queue" = queue.Queue(maxsize=64)
        self.stream = sd.OutputStream(
            samplerate=samplerate, channels=2, dtype="int16",
            blocksize=960, callback=self._cb)
        self.underrun = 0

    def _cb(self, outdata, frames, time_info, status):
        try:
            block = self.q.get_nowait()
            n = min(len(block), frames)
            outdata[:n] = block[:n]
            if n < frames:
                outdata[n:] = 0
                self.underrun += 1
        except queue.Empty:
            outdata[:] = 0
            self.underrun += 1

    def write(self, interleaved_int16):
        try:
            self.q.put_nowait(interleaved_int16)
        except queue.Full:
            try:
                self.q.get_nowait()
                self.q.put_nowait(interleaved_int16)
            except Exception:
                pass

    def start(self):
        self.stream.start()

    def stop(self):
        try:
            self.stream.stop()
            self.stream.close()
        except Exception:
            pass


def _frame_to_interleaved(frame):
    """فریم av را به آرایه (N, channels) int16 برای sounddevice تبدیل می‌کند."""
    arr = frame.to_ndarray()
    ch = len(frame.layout.channels) if frame.layout else 1
    if getattr(frame.format, "is_planar", False):
        inter = arr.T.reshape(-1)        # planar → interleaved
    else:
        inter = arr.reshape(-1)          # packed = از قبل interleaved
    n = inter.size // ch
    out = inter.reshape(n, ch)
    if ch == 1:
        out = _np.repeat(out, 2, axis=1)  # مونو → استریو برای پخش
    return out


class LiveVoiceSession:
    """گفتگوی زنده صوتی با duck.ai (همان پروتکل مرورگر)."""

    def __init__(self, client: DuckAI, model: str = "gpt-6-luna",
                 voice: str = "voice-1", audio_in: str | None = None,
                 on_event=None, verbose: bool = False):
        if not HAS_AIORTC:
            raise DuckAIError("aiortc نصب نیست → pip install aiortc")
        if not HAS_AV:
            raise DuckAIError("PyAV نصب نیست → pip install av")
        if not HAS_SD:
            raise DuckAIError("sounddevice نصب نیست → pip install sounddevice")
        self.client = client
        self.model = model
        self.voice = voice
        self.audio_in = audio_in
        self.on_event = on_event or (lambda kind, val: None)
        self.verbose = verbose
        self.pc: RTCPeerConnection | None = None
        self.dc = None
        self.player: _Player | None = None
        self.mic: _PacedAudioSource | None = None
        self._stop = asyncio.Event()
        self._tasks = []
        self.user_transcript = []   # [(role, text)]
        self.connected = threading.Event()
        self._loop = None

    # ── کمکی ──
    def _log(self, msg: str):
        self.on_event("log", msg)

    # ── تغذیه میکروفون ──
    def _start_mic_feed(self, feed_q):
        def cb(indata, frames, t, status):
            try:
                feed_q.put_nowait(indata.copy())
            except queue.Full:
                pass
        self._mic_stream = sd.InputStream(samplerate=48000, channels=1,
                                          dtype="int16", blocksize=960,
                                          callback=cb)
        self._mic_stream.start()

    def _start_file_feed(self, feed_q):
        data = open(self.audio_in, "rb").read()
        if is_webm(data):
            import tempfile
            fd, tmp = tempfile.mkstemp(suffix=".webm")
            os.close(fd)
            with open(tmp, "wb") as fh:
                fh.write(data)
            self.audio_in = tmp
        src = av.open(self.audio_in)
        astream = next(s for s in src.streams if s.type == "audio")
        res = av.AudioResampler(format="s16", layout="mono", rate=48000)

        def producer():
            try:
                # فایل یک‌بار پخش می‌شود؛ بعدش سکوت ممتد می‌فرستیم تا
                # VAD سمت سرور پایان گفتار را ببیند و پاسخ تولید شود
                for frame in src.decode(astream):
                    if self._stop.is_set():
                        break
                    for of in res.resample(frame):
                        arr = of.to_ndarray().reshape(-1)
                        for i in range(0, len(arr), 960):
                            chunk = arr[i:i + 960]
                            if chunk.shape[0] < 960:
                                chunk = _np.concatenate(
                                    [chunk,
                                     _np.zeros(960 - chunk.shape[0],
                                               dtype=chunk.dtype)])
                            while True:
                                if self._stop.is_set():
                                    return
                                try:
                                    feed_q.put_nowait(chunk)
                                    break
                                except queue.Full:
                                    time.sleep(0.005)
                self.on_event("file_played", None)
                while not self._stop.is_set():
                    try:
                        feed_q.put_nowait(_np.zeros(960, dtype="int16"))
                    except queue.Full:
                        pass
                    time.sleep(0.01)
            except Exception:
                pass
        self._feed_thread = threading.Thread(target=producer, daemon=True)
        self._feed_thread.start()

    # ── datachannel ──
    def _on_dc_message(self, message):
        try:
            v = json.loads(message)
        except Exception:
            return
        t = v.get("type", "")
        if self.verbose:
            self._log(f"[dc] {t} :: {json.dumps(v, ensure_ascii=False)[:200]}")
        if t == "input_audio_buffer.speech_started":
            self.on_event("user_speech_start", v)
        elif t == "input_audio_buffer.speech_stopped":
            self.on_event("user_speech_stop", v)
        elif t == "input_audio_buffer.committed":
            self.on_event("user_committed", v)
        elif t == "conversation.item.input_audio_transcription.delta":
            self.on_event("user_delta", v.get("delta", ""))
        elif t == "conversation.item.input_audio_transcription.completed":
            txt = v.get("transcript", "")
            self.user_transcript.append(("user", txt))
            self.on_event("user_transcript", txt)
        elif t == "response.created":
            self.on_event("response_start", v)
        elif t == "response.output_audio_transcript.delta":
            self.on_event("assistant_delta", v.get("delta", ""))
        elif t == "response.output_audio_transcript.done":
            self.on_event("assistant_transcript_done", v.get("transcript", ""))
        elif t == "response.output_item.done":
            item = v.get("item") or {}
            if item.get("type") == "function_call":
                name = item.get("name", "")
                self.on_event("tool", name)
            elif item.get("type") == "message":
                content = (item.get("content") or [{}])[0]
                txt = content.get("transcript", "")
                if txt and ("assistant", txt) not in self.user_transcript:
                    self.user_transcript.append(("assistant", txt))
                self.on_event("assistant_done", txt)
        elif t == "response.done":
            resp = v.get("response") or {}
            self.on_event("response_done", resp.get("status"))
        elif t == "output_audio_buffer.started":
            if self.mic:
                self.mic.muted = True
            self.on_event("assistant_audio_start", v)
        elif t in ("output_audio_buffer.stopped", "output_audio_buffer.cleared"):
            if self.mic:
                self.mic.muted = False
            self.on_event("assistant_audio_end" if t.endswith("stopped")
                          else "assistant_audio_cleared", v)
        elif t == "conversation.item.added":
            item = v.get("item") or {}
            if item.get("type") == "function_call" and item.get("arguments"):
                try:
                    args = json.loads(item["arguments"])
                    if "reason" in args:
                        self.on_event("end_reason", args["reason"])
                except Exception:
                    pass
        elif t == "error":
            self.on_event("dc_error", v)    # ── track دریافتی (صدای assistant) ──
    def _on_track(self, track):
        async def consume():
            try:
                while not self._stop.is_set():
                    frame = await track.recv()
                    if self.player:
                        self.player.write(_frame_to_interleaved(frame))
            except Exception:
                pass
        self._tasks.append(asyncio.ensure_future(consume()))

    # ── اتصال ──
    def _session_headers(self, journey_id: str) -> dict:
        return {
            "Content-Type": "application/json",
            "Origin": _BASE,
            "Referer": _BASE + "/",
            "x-fe-version": self.client.fe_version,
            "x-vqd-hash-1": self.client.jsa,
            "x-fe-signals": b64_json({
                "start": int(time.time() * 1000),
                "events": [{"name": "startVoiceSession_free", "delta": 119,
                            "trusted": True}],
                "end": 1500,
            }),
            "x-ddg-journey-id": journey_id,
        }

    def _do_session_post(self, offer_sdp: str, journey_id: str):
        r = self.client.s.post(
            _BASE + "/duckchat/v1/session",
            headers=self._session_headers(journey_id),
            data=json.dumps({"sdp": offer_sdp,
                             "session": {"voice": self.voice}}),
            timeout=30)
        if r.status_code != 200:
            raise DuckAIError(
                f"شروع جلسه صوتی ناموفق (HTTP {r.status_code}): {r.text[:200]}")
        return r.text

    def _fetch_ice_servers(self, journey_id: str):
        r = self.client.s.get(
            _BASE + "/duckchat/v1/ice-servers",
            headers={
                "x-fe-version": self.client.fe_version,
                "x-ddg-journey-id": journey_id,
                "x-fe-signals": _fe_signals(),
                "Referer": _BASE + "/",
            }, timeout=30)
        if r.status_code != 200:
            raise DuckAIError(f"دریافت ice-servers ناموفق (HTTP {r.status_code})")
        servers = []
        for s in r.json().get("iceServers", []):
            servers.append(RTCIceServer(
                urls=s.get("urls", []),
                username=s.get("username"),
                credential=s.get("credential"),
            ))
        return servers

    async def _run_async(self):
        journey_id = uuid.uuid4().hex
        if not (self.client.fe_version and self.client.jsa):
            await asyncio.to_thread(self.client.rehandshake)
        ice_servers = await asyncio.to_thread(self._fetch_ice_servers, journey_id)
        self._log(f"TURN: {len(ice_servers)} سرور")

        last_err = None
        for attempt in range(3):
            if attempt:
                await asyncio.sleep(2 + attempt * 2)
            try:
                await self._connect_once(ice_servers, journey_id)
                return
            except Exception as e:
                last_err = e
                self._log(f"تلاش {attempt + 1} ناموفق: {e}")
                await self._teardown_pc()
        if isinstance(last_err, DuckAIError):
            raise last_err
        raise DuckAIError(f"اتصال ویس زنده ناموفق: {last_err}")

    async def _connect_once(self, ice_servers, journey_id):
        config = RTCConfiguration(iceServers=ice_servers)
        self.pc = RTCPeerConnection(configuration=config)
        self.player = _Player()
        self.player.start()

        feed_q: "queue.Queue" = queue.Queue(maxsize=100)
        if self.audio_in:
            self._start_file_feed(feed_q)
            self._log(f"ورودی صوتی از فایل: {self.audio_in}")
        else:
            self._start_mic_feed(feed_q)
            self._log("میکروفون فعال شد")
        self.mic = _PacedAudioSource(feed_q)
        self.pc.addTrack(self.mic)

        self.dc = self.pc.createDataChannel("duckai-voice-session")

        @self.dc.on("open")
        def on_open():
            self.connected.set()
            self.on_event("connected", None)

        @self.dc.on("message")
        def on_message(message):
            self._on_dc_message(message)

        @self.dc.on("closed")
        def on_closed():
            self.on_event("dc_closed", None)

        self.pc.on("track")(self._on_track)

        @self.pc.on("connectionstatechange")
        async def on_state():
            self._log(f"WebRTC: {self.pc.connectionState} "
                      f"(ice: {self.pc.iceConnectionState})")
            if self.pc.connectionState in ("failed", "closed"):
                self._stop.set()

        offer = await self.pc.createOffer()
        await self.pc.setLocalDescription(offer)
        # 418/500 گذراست — با چالش تازه همان offer را دوباره می‌فرستیم
        answer_sdp = None
        for post_attempt in range(5):
            if post_attempt:
                await asyncio.sleep(2 + post_attempt * 2)
                await asyncio.to_thread(self.client.rehandshake)
            try:
                answer_sdp = await asyncio.to_thread(
                    self._do_session_post, self.pc.localDescription.sdp,
                    journey_id)
                break
            except DuckAIError as e:
                self._log(f"POST session تلاش {post_attempt + 1} ناموفق: {e}")
        if answer_sdp is None:
            raise DuckAIError("POST session پس از ۵ تلاش ناموفق بود")

        await self.pc.setRemoteDescription(
            RTCSessionDescription(sdp=answer_sdp, type="answer"))
        self._log("answer SDP اعمال شد — در حال اتصال ICE…")

        # اگر در ۳۰ ثانیه datachannel باز نشد، از نو تلاش می‌کنیم
        for _ in range(300):
            if self._stop.is_set() or self.connected.is_set():
                break
            await asyncio.sleep(0.1)
        if not self.connected.is_set():
            self._stop.set()
            raise DuckAIError("datachannel در ۳۰ ثانیه باز نشد (ICE ناموفق)")
        await self._stop.wait()

    async def _teardown_pc(self):
        try:
            if self.pc:
                await self.pc.close()
        except Exception:
            pass
        self.pc = None
        self.dc = None
        self.connected.clear()

    def run(self, stop_event: threading.Event | None = None):
        """اجرای جلسه (بلاک‌کننده). پایان: Ctrl+C، stop_event یا بسته‌شدن چنل."""
        self._loop = asyncio.new_event_loop()
        asyncio.set_event_loop(self._loop)

        def watchdog():
            while not self._stop.is_set():
                if stop_event and stop_event.is_set():
                    self._stop.set()
                if self.connected.is_set() and (self.dc is None or
                                                self.dc.readyState == "closed"):
                    self._stop.set()
                time.sleep(0.2)
        wd = threading.Thread(target=watchdog, daemon=True)
        wd.start()
        try:
            self._loop.run_until_complete(self._run_async())
        except KeyboardInterrupt:
            pass
        finally:
            self.close()
            self._loop.close()
        return self.user_transcript

    def stop(self):
        self._stop.set()

    def close(self):
        try:
            if hasattr(self, "_mic_stream"):
                self._mic_stream.stop()
                self._mic_stream.close()
        except Exception:
            pass
        try:
            if self.player:
                self.player.stop()
        except Exception:
            pass
        try:
            if self._loop and not self._loop.is_closed():
                self._loop.run_until_complete(self._teardown_pc())
        except Exception:
            pass
        for t in list(self._tasks):
            t.cancel()


# ────────────────────────── رابط ترمینال ──────────────────────────

def live_status_printer(kind, val):
    if kind == "connected":
        print("  ✔ اتصال برقرار شد — صحبت کنید (Enter = پایان)", flush=True)
    elif kind == "user_speech_start":
        print("\n  🎙 …", end="", flush=True)
    elif kind == "file_played":
        print("\n  (پخش فایل تمام شد — در انتظار پاسخ…)", flush=True)
    elif kind == "user_transcript":
        print(f"\n  شما: {val}", flush=True)
    elif kind == "assistant_delta":
        print(val, end="", flush=True)
    elif kind == "assistant_done":
        if val:
            print(flush=True)
    elif kind == "tool":
        if val == "WebSearch":
            print("\n  🔍 در حال جستجوی وب…", flush=True)
        else:
            print(f"\n  🔧 ابزار: {val}", flush=True)
    elif kind == "assistant_audio_start":
        print("\n  🔊 …", end="", flush=True)
    elif kind == "response_done":
        if val and val not in ("completed",):
            print(f"\n  (وضعیت پاسخ: {val})", flush=True)
    elif kind == "dc_closed":
        print("\n  ✘ جلسه صوتی بسته شد.", flush=True)
    elif kind == "dc_error":
        print(f"\n  [dc خطا] {json.dumps(val, ensure_ascii=False)[:200]}", flush=True)
    elif kind == "end_reason":
        print(f"\n  (دلیل پایان جلسه: {val})", flush=True)


def run_live(client: DuckAI, model: str, voice: str = "voice-1",
             audio_in: str | None = None, verbose: bool = False) -> list:
    ensure_voice_deps(need_mic=audio_in is None, need_live=True)
    sess = LiveVoiceSession(client, model=model, voice=voice,
                            audio_in=audio_in, on_event=live_status_printer,
                            verbose=verbose)
    stop_ev = threading.Event()

    def key_watcher():
        try:
            input()
            stop_ev.set()
        except Exception:
            stop_ev.set()
    threading.Thread(target=key_watcher, daemon=True).start()
    print("\n🎙 گفتگوی زنده شروع شد (در حال اتصال…) — Enter = پایان")
    if audio_in is None:
        print("  ⚠ هندزفری بزنید تا صدای بلندگو وارد میکروفون نشود.")
    try:
        transcript = sess.run(stop_event=stop_ev)
    except DuckAIError as e:
        print(f"[خطا] {e}")
        return []
    print("\n" + "-" * 55)
    print("خلاصه گفتگوی زنده:")
    for role, txt in transcript:
        who = "شما" if role == "user" else "دستیار"
        print(f"  {who}: {txt}")
    return transcript
