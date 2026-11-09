# duck_cli.py — کلاینت رایگان DuckDuckGo AI Chat (duck.ai) — نوامبر ۲۰۲۶ v2
#
# پروتکل (ریورس‌شده از HAR واقعی + منطبق با revesis/duckai آپدیت اکتبر ۲۰۲۶):
#   1) GET  https://duck.ai/            → data-version-tag + data-version-sha  =>  x-fe-version
#   2) GET  /duckchat/v1/status (x-vqd-accept: 1)  → هدر x-vqd-hash-1 = base64(چالش JS)
#   3)  اجرای چالش با Node + jsdom      →  {server_hashes, client_hashes, signals, meta}
#   4)  x-vqd-hash-1 نهایی = base64(JSON با client_hashes = sha256(raw) بase64)
#   5) POST /duckchat/v1/chat  → SSE استریم پاسخ
#
# امکانات v2 (بر اساس HAR واقعی ۲۰۲۶-۱۱-۰۳ + تست زنده):
#   • ارسال تصویر: {"type":"image","mimeType":"image/webp","image":"data:image/webp;base64,..."}
#     ⚠ سرور فقط WebP قبول می‌کند (JPEG → 400 ERR_BAD_REQUEST) — با Pillow خودکار تبدیل می‌شود
#   • تولید تصویر: metadata={"toolChoice":{"GenerateImage":true}} →
#     رویدادهای SSE با role=ui-component و name=generate-image و data.b64Image (JPEG)
#   • فایل‌های متنی/کد به‌صورت متن داخل پرامپت ارسال می‌شوند
#   • تغییر مدل: در منو، در آرگومان --model و دستور /model وسط گفتگو
#
# پیش‌نیازها:
#   pip install requests
#   pip install pillow        (برای تبدیل تصویر به WebP — ضروری برای دیدن/ساختن تصویر)
#   node در PATH +  npm install jsdom   (در همین پوشه)
#
# مدل‌ها: gpt-6-luna (پیش‌فرض), gpt-5.6-luna, gpt-5.4-mini, gpt-5.4-nano,
#         claude-haiku-4-5, mistral-small-2603
#
# استفاده:
#   python duck_cli.py                                    → منوی تعاملی
#   python duck_cli.py --ask "سلام، حالت چطوره؟"
#   python duck_cli.py --ask "این چیه؟" --image photo.jpg → دیدن تصویر
#   python duck_cli.py --ask "این کد چه می‌کند؟" --file main.py
#   python duck_cli.py --draw "یک گربه نارنجی بامزه"      → تولید تصویر (ذخیره JPEG)
#   python duck_cli.py --ask "hi" --model mini             → gpt-5.4-mini
#   python duck_cli.py --chat                              → گفتگوی پیوسته با حافظه
#   در گفتگوی پیوسته:  /img عکس.jpg   /file code.py   /draw یک آسمان پرستاره   /model   /exit
#   ویس:  /mic (ضبط و تبدیل به متن)   /live (گفتگوی زنده صوتی)   --voice   --listen   --dictate فایل

import argparse
import base64
import hashlib
import io
import json
import mimetypes
import os
import re
import subprocess
import sys
import tempfile
import threading
import time
import uuid

if sys.platform == "win32":
    os.environ.setdefault("PYTHONIOENCODING", "utf-8")
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

import requests

try:
    from PIL import Image
    HAS_PIL = True
except ImportError:
    HAS_PIL = False

HERE = os.path.dirname(os.path.abspath(__file__))
_BASE = "https://duck.ai"

UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36")

MODELS = {
    "luna": "gpt-6-luna",
    "gpt-6-luna": "gpt-6-luna",
    "gpt-5.6-luna": "gpt-5.6-luna",
    "nano": "gpt-5.4-nano",
    "mini": "gpt-5.4-mini",
    "haiku": "claude-haiku-4-5",
    "mistral": "mistral-small-2603",
}

# سقف‌های تصویر (شبیه رفتار مرورگر duck.ai)
IMG_MAX_DIM = 1568          # بزرگ‌ترین ضلع
IMG_WEBP_QUALITY = 85
IMG_MAX_PAYLOAD = 3_500_000  # سقف حجم data-url برای جلوگیری از 400

_TEXT_EXTS = {
    ".txt", ".md", ".markdown", ".rst", ".log", ".csv", ".tsv", ".json",
    ".jsonl", ".xml", ".yaml", ".yml", ".ini", ".cfg", ".conf", ".toml",
    ".env", ".py", ".js", ".mjs", ".cjs", ".ts", ".tsx", ".jsx", ".java",
    ".c", ".h", ".cpp", ".hpp", ".cc", ".cs", ".go", ".rs", ".rb", ".php",
    ".swift", ".kt", ".kts", ".sh", ".bash", ".zsh", ".ps1", ".bat", ".cmd",
    ".sql", ".html", ".htm", ".css", ".scss", ".less", ".vue", ".svelte",
    ".dart", ".lua", ".pl", ".r", ".m", ".asm", ".gradle", ".cmake",
    ".dockerfile", ".gitignore", ".properties", ".sql", ".prisma", ".graphql",
}

_SOLVE_LOCK = threading.Lock()


def b64(data: bytes) -> str:
    return base64.b64encode(data).decode()


def sha256_b64(text: str) -> str:
    return b64(hashlib.sha256(text.encode()).digest())


def b64_json(obj) -> str:
    return b64(json.dumps(obj, separators=(",", ":")).encode())


class DuckAIError(RuntimeError):
    def __init__(self, message: str, status: int | None = None):
        super().__init__(message)
        self.status = status


# ─────────────────────────── کمکی‌های تصویر و فایل ───────────────────────────

def image_to_data_url(path: str) -> dict:
    """تبدیل هر تصویر به WebP data-url (تنها فرمتی که سرور می‌پذیرد)."""
    if not os.path.isfile(path):
        raise DuckAIError(f"فایل تصویر پیدا نشد: {path}")
    if not HAS_PIL:
        # بدون Pillow فقط WebP خام قابل ارسال است
        with open(path, "rb") as fh:
            raw = fh.read()
        if len(raw) > IMG_MAX_PAYLOAD:
            raise DuckAIError(f"تصویر خیلی بزرگ است و Pillow نصب نیست: {path}")
        return {
            "type": "image",
            "mimeType": "image/webp",
            "image": "data:image/webp;base64," + b64(raw),
        }
    try:
        im = Image.open(path)
        im.load()
    except Exception as e:
        raise DuckAIError(f"بازکردن تصویر ناموفق ({path}): {e}")
    if im.mode in ("RGBA", "P", "LA"):
        im = im.convert("RGBA")
        # پس‌زمینه سفید برای شفافیت
        bg = Image.new("RGB", im.size, (255, 255, 255))
        bg.paste(im, mask=im.split()[-1])
        im = bg
    elif im.mode != "RGB":
        im = im.convert("RGB")
    # کوچک‌سازی در صورت بزرگ بودن
    w, h = im.size
    scale = max(w, h) / IMG_MAX_DIM
    if scale > 1:
        im = im.resize((int(w / scale), int(h / scale)),
                       Image.LANCZOS if hasattr(Image, "LANCZOS") else Image.BICUBIC)
    buf = io.BytesIO()
    im.save(buf, "WEBP", quality=IMG_WEBP_QUALITY)
    data = buf.getvalue()
    # اگر بزرگ ماند، کیفیت را پله‌پله کم کن
    q = IMG_WEBP_QUALITY
    while len(data) > IMG_MAX_PAYLOAD and q > 30:
        q -= 15
        buf = io.BytesIO()
        im.save(buf, "WEBP", quality=q)
        data = buf.getvalue()
    if len(data) > IMG_MAX_PAYLOAD:
        raise DuckAIError(f"تصویر پس از فشرده‌سازی همچنان بزرگ است: {path}")
    return {
        "type": "image",
        "mimeType": "image/webp",
        "image": "data:image/webp;base64," + b64(data),
    }


def images_to_parts(paths: list[str]) -> list[dict]:
    return [image_to_data_url(p) for p in paths]


def file_to_prompt_chunk(path: str, max_chars: int = 60_000) -> str:
    """محتوای فایل متنی/کد به‌صورت بلوک کد برای پرامپت."""
    if not os.path.isfile(path):
        raise DuckAIError(f"فایل پیدا نشد: {path}")
    ext = os.path.splitext(path)[1].lower().lstrip(".")
    mime_guess = mimetypes.guess_type(path)[0] or ""
    if not (ext in _TEXT_EXTS or mime_guess.startswith("text/") or ext == ""):
        raise DuckAIError(
            f"«{os.path.basename(path)}» فایل متنی نیست. duck.ai فقط تصویر (WebP) و "
            "متن را می‌پذیرد؛ فایل‌های باینری قابل ارسال نیستند.")
    try:
        with open(path, "r", encoding="utf-8", errors="replace") as fh:
            content = fh.read()
    except OSError as e:
        raise DuckAIError(f"خواندن فایل ناموفق ({path}): {e}")
    truncated = ""
    if len(content) > max_chars:
        content = content[:max_chars]
        truncated = f"\n\n[… فایل طولانی بود و به {max_chars} کاراکتر برش خورد]"
    name = os.path.basename(path)
    lang = ext if ext else "text"
    return f"\n\nمحتوای فایل «{name}»:\n```{lang}\n{content}\n```{truncated}\n"


# ─────────────────────────────── کلاینت ───────────────────────────────

class DuckAI:
    def __init__(self, ua: str = UA, timeout: int = 60, proxy: str | None = None):
        self.ua = ua
        self.timeout = timeout
        self.s = requests.Session()
        self.s.headers.update({"User-Agent": ua, "Accept-Language": "en-US,en;q=0.9"})
        if proxy:
            self.s.proxies = {"http": proxy, "https": proxy}
        self.fe_version = ""
        self.jsa = ""  # آخرین proof (برای درخواست‌های بعدی همان مکالمه)

    # ────────── handshake ──────────

    def bootstrap(self):
        r = self.s.get(_BASE + "/", timeout=self.timeout)
        r.raise_for_status()
        tag = re.search(r'data-version-tag="([^"]*)"', r.text)
        sha = re.search(r'data-version-sha="([^"]*)"', r.text)
        self.fe_version = f"{tag.group(1) if tag else 'dev'}-{sha.group(1) if sha else 'hash'}"
        return self

    def fetch_challenge(self) -> str:
        r = self.s.get(
            _BASE + "/duckchat/v1/status",
            headers={"x-vqd-accept": "1", "Cache-Control": "no-store",
                     "x-fe-version": self.fe_version,
                     "Origin": _BASE, "Referer": _BASE + "/"},
            timeout=self.timeout,
        )
        raw = r.headers.get("x-vqd-hash-1")
        if not raw:
            raise DuckAIError(f"چالشی دریافت نشد (HTTP {r.status_code}): {r.text[:200]}")
        return base64.b64decode(raw + "=" * (-len(raw) % 4)).decode("utf-8", "replace")

    def solve(self, js_source: str) -> dict:
        """اجرای چالش با Node + jsdom."""
        runner = os.path.join(HERE, "jsa_jsdom.js")
        if not os.path.isfile(runner):
            raise DuckAIError("jsa_jsdom.js پیدا نشد — کنار همین اسکریپت باید باشد")
        fd, path = tempfile.mkstemp(suffix=".js", dir=HERE)
        os.close(fd)
        try:
            with open(path, "w", encoding="utf-8") as fh:
                fh.write(js_source)
            with _SOLVE_LOCK:
                out = subprocess.run(
                    ["node", runner, path, self.ua],
                    capture_output=True, text=True, timeout=90,
                    cwd=HERE,
                )
        finally:
            try:
                os.remove(path)
            except OSError:
                pass
        if out.returncode != 0 or not out.stdout.strip():
            raise DuckAIError(f"اجرای چالش ناموفق: {out.stderr[:400]}")
        result = json.loads(out.stdout)
        if "__error" in result:
            raise DuckAIError(f"خطای داخل چالش: {result['__error'][:400]}")
        return result

    def build_proof(self, solved: dict) -> str:
        proof = dict(solved)
        proof["client_hashes"] = [sha256_b64(x) for x in solved["client_hashes"]]
        meta = dict(solved.get("meta") or {})
        meta.update({
            "origin": _BASE,
            "stack": ("Error\nat l (https://duck.ai/dist/duckai-dist/entry.duckai.js:2:2129171)\n"
                      "at async https://duck.ai/dist/duckai-dist/entry.duckai.js:2:1859809"),
            "duration": "58",
        })
        proof["meta"] = meta
        return b64_json(proof)

    def rehandshake(self):
        """چالش تازه گرفتن (برای رفع 418 گذرا)."""
        self.bootstrap()
        self.jsa = self.build_proof(self.solve(self.fetch_challenge()))

    # ────────── chat ──────────

    def chat(self, prompt: str, model: str = "gpt-6-luna", tools: bool = True,
             history: list | None = None, images: list[dict] | None = None,
             draw: bool = False, prompt_extra: str = ""):
        content = [{"type": "text", "text": prompt + prompt_extra}]
        if images:
            content.extend(images)  # ترتیب مثل مرورگر: اول متن بعد تصویر
        msgs = (history or []) + [{"role": "user", "content": content}]
        body = {
            "model": model,
            "messages": msgs,
            "canUseTools": tools,
            "reasoningEffort": "none",
            "canUseApproxLocation": None,
            "canDelegateImageGeneration": None,
            "canShowGreeting": False,
        }
        if draw:
            # همان کاری که مرورگر برای «بکش/بساز» می‌کند
            body["metadata"] = {"toolChoice": {"GenerateImage": True}}
        headers = {
            "Content-Type": "application/json",
            "Accept": "text/event-stream",
            "Origin": _BASE,
            "Referer": _BASE + "/",
            "x-fe-version": self.fe_version,
            "x-fe-signals": b64_json({
                "start": int(time.time() * 1000),
                "events": [{"name": "action", "delta": 1200, "trusted": True}],
                "end": 1500,
            }),
            "X-Vqd-Hash-1": self.jsa,
        }
        return self.s.post(_BASE + "/duckchat/v1/chat", headers=headers,
                           data=json.dumps(body), stream=True, timeout=self.timeout)

    # ────────── استریم رویداد خام ──────────

    def stream_events(self, prompt: str, model: str = "gpt-6-luna", retries: int = 4,
                      history: list | None = None, images: list[dict] | None = None,
                      draw: bool = False, prompt_extra: str = ""):
        """ژنراتور رویدادهای SSE؛ هر آیتم یکی از:
             ("message", str)            — تکه متن پاسخ
             ("image", dict)             — تصویر نهایی {b64, width, height, format}
             ("image_partial", dict)     — پیش‌نمایش تدریجی
             ("image_title", str)        — عنوان مرحله تولید تصویر
             ("tool", dict)              — فراخوانی ابزار (GenerateImage/WebSearch/...)
           خطاها DuckAIError می‌دهند."""
        r = None
        last = ""
        status = None
        for attempt in range(retries):
            if attempt:
                self.rehandshake()
            else:
                if not self.fe_version or not self.jsa:
                    self.rehandshake()
            r = self.chat(prompt, model, history=history, images=images,
                          draw=draw, prompt_extra=prompt_extra)
            if r.status_code == 200:
                break
            status = r.status_code
            last = f"HTTP {r.status_code}: {r.text[:200]}"
            # 418 = امتیاز تقلب DDG؛ با چالش تازه معمولاً رفع می‌شود
            time.sleep(2 + attempt * 2)
        else:
            raise DuckAIError(f"چت پس از {retries} تلاش ناموفق بود: {last}", status=status)

        for raw in r.iter_lines():
            if not raw:
                continue
            line = raw.decode("utf-8", "replace") if isinstance(raw, bytes) else raw
            if not line.startswith("data: "):
                continue
            payload = line[6:]
            if payload.startswith("["):  # [PING] / [DONE] / [CHAT_TITLE:...]
                continue
            try:
                ev = json.loads(payload)
            except json.JSONDecodeError:
                continue
            if ev.get("action") == "error":
                raise DuckAIError(
                    f"خطای سرور ({ev.get('status')}): {ev.get('type', '?')}")
            role = ev.get("role", "")
            name = ev.get("name", "")
            # متن پاسخ
            msg = ev.get("message")
            if isinstance(msg, str) and msg:
                yield ("message", msg)
                continue
            # رویدادهای تولید تصویر
            if role == "ui-component" and name == "generate-image":
                data = ev.get("data") or {}
                dtype = data.get("type")
                if dtype == "image-title":
                    yield ("image_title", data.get("title", ""))
                    continue
                if dtype == "image-partial" or data.get("status") == "partial":
                    yield ("image_partial", data)
                    continue
                if data.get("status") == "success" and data.get("b64Image"):
                    yield ("image", {
                        "b64": data["b64Image"],
                        "width": data.get("width"),
                        "height": data.get("height"),
                        "format": data.get("format", "jpeg"),
                    })
                    continue
            # فراخوانی ابزارها
            if role == "tool-invocation":
                yield ("tool", {
                    "toolName": ev.get("toolName"),
                    "state": ev.get("state"),
                    "toolArguments": ev.get("toolArguments"),
                })
                continue

    def stream(self, prompt: str, model: str = "gpt-6-luna", retries: int = 4,
               history: list | None = None, images: list[dict] | None = None,
               prompt_extra: str = ""):
        for kind, val in self.stream_events(prompt, model=model, retries=retries,
                                            history=history, images=images,
                                            prompt_extra=prompt_extra):
            if kind == "message":
                yield val

    def ask(self, prompt: str, model: str = "gpt-6-luna", on_delta=None,
            retries: int = 4, history: list | None = None,
            images: list[dict] | None = None, files: list[str] | None = None) -> str:
        prompt_extra = ""
        for f in (files or []):
            prompt_extra += file_to_prompt_chunk(f)
        parts = []
        for delta in self.stream(prompt, model=model, retries=retries, history=history,
                                 images=images, prompt_extra=prompt_extra):
            parts.append(delta)
            if on_delta:
                on_delta(delta)
        return "".join(parts)

    # ────────── تولید تصویر ──────────

    def generate_image(self, prompt: str, model: str = "gpt-6-luna",
                       out_dir: str | None = None, on_progress=None,
                       retries: int = 4, history: list | None = None):
        """تولید تصویر و ذخیره JPEG. خروجی: (مسیر فایل، متن همراه تصویر)"""
        out_dir = out_dir or HERE
        os.makedirs(out_dir, exist_ok=True)
        img = None
        text_parts = []
        tool_seen = False
        for kind, val in self.stream_events(prompt, model=model, retries=retries,
                                            history=history, draw=True):
            if kind == "message":
                text_parts.append(val)
                if on_progress:
                    on_progress("text", val)
            elif kind == "image_title":
                if on_progress:
                    on_progress("title", val)
            elif kind == "image_partial":
                tool_seen = True
                if on_progress:
                    on_progress("partial", None)
            elif kind == "tool":
                tool_seen = True
                if on_progress:
                    on_progress("tool", val.get("toolName"))
            elif kind == "image":
                img = val
        if not img:
            raise DuckAIError("تصویری در پاسخ نبود" +
                              (" (ابزار اجرا نشد؟)" if not tool_seen else ""))
        raw = base64.b64decode(img["b64"])
        ext = "jpg" if img.get("format", "jpeg").lower().startswith("jp") else \
            (img.get("format") or "jpg").lower()
        fname = f"duckai_{time.strftime('%Y%m%d_%H%M%S')}_{uuid.uuid4().hex[:6]}.{ext}"
        path = os.path.join(out_dir, fname)
        with open(path, "wb") as fh:
            fh.write(raw)
        return path, "".join(text_parts), img

    # گفتگوی پیوسته: تاریخچه را در قالب duck.ai نگه می‌دارد
    def chat_turn(self, prompt: str, model: str, history: list,
                  images: list[dict] | None = None,
                  files: list[str] | None = None) -> str:
        prompt_extra = ""
        for f in (files or []):
            prompt_extra += file_to_prompt_chunk(f)
        answer = self._ask_with_extra(prompt, model, history, images, prompt_extra)
        content = [{"type": "text", "text": prompt}]
        if images:
            content.extend(images)
        if prompt_extra:
            content[0]["text"] = prompt + prompt_extra
        history.append({"role": "user", "content": content})
        history.append({"role": "assistant", "content": answer})
        return answer

    def _ask_with_extra(self, prompt, model, history, images, prompt_extra):
        parts = []
        for delta in self.stream(prompt, model=model, history=history,
                                 images=images, prompt_extra=prompt_extra):
            parts.append(delta)
        return "".join(parts)


# ───────────────────────────── رابط ترمینال ─────────────────────────────

def print_header():
    print("\n" + "=" * 58)
    print("   DuckDuckGo AI Chat — نسخه غیررسمی (رایگان، بدون کلید) — v2")
    print("   تصویر ببین ✔  تصویر بساز ✔  فایل بخوان ✔  مدل عوض کن ✔")
    print("=" * 58)


def model_table() -> list:
    return list(MODELS)


def choose_model(current: str | None = None) -> str:
    print("\nمدل را انتخاب کنید:")
    keys = model_table()
    cur_id = None
    for i, k in enumerate(keys, 1):
        mark = ""
        if current and MODELS[k] == current:
            mark = "  ← الان"
            cur_id = i
        print(f"  {i}. {k:12} → {MODELS[k]}{mark}")
    while True:
        c = input("\nشماره مدل (Enter = بدون تغییر): ").strip()
        if not c:
            return current or MODELS[keys[0]]
        if c.isdigit() and 1 <= int(c) <= len(keys):
            return MODELS[keys[int(c) - 1]]
        print("شماره معتبر وارد کنید.")


def resolve_model(name: str | None, default: str = "gpt-6-luna") -> str:
    return MODELS.get(name or "", name or default)


# ─────────────────── حلقه گفتگو با دستورهای / ───────────────────

HELP = """
دستورها در گفتگو:
  /img <مسیر> [مسیر2 ...]   اضافه‌کردن تصویر به پیام بعدی (خودکار به WebP تبدیل می‌شود)
  /file <مسیر> [مسیر2 ...]  پیوست فایل متنی/کد به پیام بعدی
  /draw <توضیح>             ساخت تصویر (مثال: /draw یک آسمان پرستاره)
  /model                    تغییر مدل
  /mic                      ضبط صدای میکروفون، تبدیل به متن و ارسال
  /live                     گفتگوی زنده صوتی (تماس دوطرفه — هندزفری بزن)
  /clear                    پاک‌کردن حافظه گفتگو
  /exit یا Enter خالی       پایان
پیام معمولی + تصویر/فایل در انتظار:  اول /img یا /file بزن، بعد متن را بنویس.
"""


def chat_loop(client: DuckAI, model: str, out_dir: str | None = None):
    print("\nگفتگو شروع شد" + HELP + "-" * 55)
    history = []
    pending_images: list[dict] = []
    pending_files: list[str] = []
    while True:
        try:
            prompt = input("\nشما> ").strip()
        except (EOFError, KeyboardInterrupt):
            break
        if not prompt:
            break

        # ── دستورهای ویس ──
        if prompt == "/live":
            try:
                import duck_voice as dv
                dv.run_live(client, model)
            except Exception as e:
                print(f"[خطا] {e}")
            continue
        if prompt == "/mic":
            try:
                import duck_voice as dv
                dv.ensure_voice_deps()
                prompt = dv.record_and_transcribe(client, model)
                if not prompt:
                    continue
                print("-" * 55)
            except Exception as e:
                print(f"[خطا] {e}")
                continue
        # ── دستورها ──
        if prompt.startswith("/"):
            parts = prompt.split(maxsplit=1)
            cmd = parts[0].lower()
            arg = parts[1].strip() if len(parts) > 1 else ""
            if cmd == "/exit":
                break
            if cmd == "/model":
                model = choose_model(model)
                print(f"مدل فعلی: {model}")
                continue
            if cmd == "/clear":
                history.clear()
                print("حافظه گفتگو پاک شد.")
                continue
            if cmd == "/help":
                print(HELP)
                continue
            if cmd == "/img":
                if not arg:
                    print("مسیر تصویر بده: /img عکس.jpg")
                    continue
                try:
                    for p in arg.replace('"', " ").split():
                        pending_images.append(image_to_data_url(p))
                    print(f"✔ {len(pending_images)} تصویر آماده ارسال در پیام بعدی.")
                except Exception as e:
                    print(f"[خطا] {e}")
                continue
            if cmd == "/file":
                if not arg:
                    print("مسیر فایل بده: /file main.py")
                    continue
                pending_files.extend(arg.replace('"', " ").split())
                print(f"✔ {len(pending_files)} فایل آماده ارسال در پیام بعدی.")
                continue
            if cmd == "/draw":
                if not arg:
                    print("توضیح تصویر بده: /draw یک گربه نارنجی")
                    continue
                print("\n🎨 در حال کشیدن…", flush=True)
                try:
                    def prog(kind, val):
                        if kind == "title":
                            print(f"   🖌 {val}", flush=True)
                        elif kind == "partial":
                            pass  # پیش‌نمایش تدریجی را بی‌صدا رد می‌کنیم
                    path, text, info = client.generate_image(
                        arg, model=model, out_dir=out_dir, on_progress=prog,
                        history=history)
                    size_kb = os.path.getsize(path) // 1024
                    print(f"✔ تصویر ذخیره شد: {path}  ({info.get('width')}×"
                          f"{info.get('height')}، {size_kb} KB)")
                    if text:
                        print(text)
                    # نگه‌داشتن در تاریخچه مثل مرورگر (برای ویرایش/ادامه کار)
                    history.append({"role": "user",
                                    "content": [{"type": "text", "text": arg}]})
                    history.append({"role": "assistant", "content": "", "parts": [
                        {"type": "generated-image", "result": info["b64"],
                         "width": info.get("width"), "height": info.get("height"),
                         "format": info.get("format", "jpeg")},
                        {"type": "text", "text": text or ""},
                    ]})
                except Exception as e:
                    print(f"[خطا] {e}")
                continue
            print("دستور ناشناخته. /help را ببین.")
            continue

        # ── پیام معمولی (+ پیوست‌های در انتظار) ──
        print("\n…", end="", flush=True)
        try:
            prompt_extra = ""
            for f in pending_files:
                prompt_extra += file_to_prompt_chunk(f)
            parts = []
            for delta in client.stream(prompt, model=model, history=history,
                                       images=pending_images or None,
                                       prompt_extra=prompt_extra):
                parts.append(delta)
                print(delta, end="", flush=True)
            answer = "".join(parts)
            content = [{"type": "text", "text": prompt + prompt_extra}]
            content.extend(pending_images)
            history.append({"role": "user", "content": content})
            history.append({"role": "assistant", "content": answer})
            print("\n")
        except Exception as e:
            print(f"\n[خطا] {e}")
        finally:
            pending_images.clear()
            pending_files.clear()
    print("-" * 55)


def draw_once(client: DuckAI, prompt: str, model: str, out_dir: str | None):
    print(f"\n🎨 در حال تولید تصویر: «{prompt}»")
    try:
        def prog(kind, val):
            if kind == "title":
                print(f"   🖌 {val}", flush=True)
        path, text, info = client.generate_image(prompt, model=model,
                                                 out_dir=out_dir, on_progress=prog)
        size_kb = os.path.getsize(path) // 1024
        print(f"✔ ذخیره شد: {path}  ({info.get('width')}×{info.get('height')}، {size_kb} KB)")
        if text:
            print(text)
    except Exception as e:
        print(f"[خطا] {e}")
        sys.exit(2)


def main():
    parser = argparse.ArgumentParser(description="DuckDuckGo AI Chat CLI (رایگان) v2")
    parser.add_argument("--ask", help="سؤال تک‌باره (غیرتعاملی)")
    parser.add_argument("--image", nargs="+", default=[],
                        help="مسیر یک یا چند تصویر (خودکار به WebP تبدیل می‌شود)")
    parser.add_argument("--file", nargs="+", default=[],
                        help="مسیر یک یا چند فایل متنی/کد")
    parser.add_argument("--draw", help="تولید تصویر از توضیح متنی (غیرتعاملی)")
    parser.add_argument("--out", help="پوشه ذخیره تصاویر ساخته‌شده (پیش‌فرض: همین پوشه)")
    parser.add_argument("--model", default=None,
                        help="luna | mini | nano | haiku | mistral | gpt-6-luna | ...")
    parser.add_argument("--proxy", help="http://host:port یا socks5://host:port")
    parser.add_argument("--chat", action="store_true", help="گفتگوی پیوسته تعاملی")
    parser.add_argument("--voice", action="store_true",
                        help="گفتگوی زنده صوتی دوطرفه (WebRTC — مثل تماس با هوش مصنوعی)")
    parser.add_argument("--listen", action="store_true",
                        help="ضبط از میکروفون و تبدیل به متن (Enter = پایان ضبط)")
    parser.add_argument("--dictate", metavar="FILE",
                        help="تبدیل فایل صوتی (wav/mp3/m4a/webm/...) به متن")
    args = parser.parse_args()

    model = resolve_model(args.model)
    out_dir = args.out

    if args.draw:
        draw_once(DuckAI(proxy=args.proxy), args.draw, model, out_dir)
        return

    if args.dictate:
        import duck_voice as dv
        try:
            print(dv.transcribe_file(DuckAI(proxy=args.proxy), args.dictate, model))
        except Exception as e:
            print(f"[خطا] {e}")
            sys.exit(2)
        return

    if args.listen:
        import duck_voice as dv
        try:
            print(dv.record_and_transcribe(DuckAI(proxy=args.proxy), model))
        except Exception as e:
            print(f"[خطا] {e}")
            sys.exit(2)
        return

    if args.voice:
        print_header()
        import duck_voice as dv
        dv.run_live(DuckAI(proxy=args.proxy), model)
        return

    if args.ask:
        client = DuckAI(proxy=args.proxy)
        try:
            imgs = images_to_parts(args.image) if args.image else None
            answer = client.ask(args.ask, model=model,
                                on_delta=lambda d: print(d, end="", flush=True),
                                images=imgs, files=args.file or None)
            print()
        except Exception as e:
            print(f"[خطا] {e}")
            sys.exit(2)
        return

    if args.chat:
        print_header()
        print(f"مدل: {model}")
        if not HAS_PIL:
            print("⚠ Pillow نصب نیست — برای ارسال تصویر نصبش کن: pip install pillow")
        chat_loop(DuckAI(proxy=args.proxy), model, out_dir=out_dir)
        return

    print_header()
    if not HAS_PIL:
        print("⚠ Pillow نصب نیست — برای ارسال تصویر نصبش کن: pip install pillow")
    while True:
        print("\nچه کاری می‌خوای انجام بدی؟")
        print("  1. گفتگوی متنی (با حافظه، تصویر و فایل)")
        print("  2. یک سؤال تک‌باره")
        print("  3. تولید تصویر 🎨")
        print("  4. تغییر مدل")
        print("  5. گفتگوی زنده صوتی 🎙 (مثل تماس تلفنی)")
        print("  6. ویس به متن (میکروفون یا فایل صوتی)")
        print("  0. خروج")
        choice = input("\nانتخاب شما: ").strip()
        if choice == "0":
            print("\nخداحافظ!")
            break
        elif choice == "1":
            chat_loop(DuckAI(proxy=args.proxy), model, out_dir=out_dir)
        elif choice == "2":
            print("\nسؤال خود را وارد کنید (برای لغو Enter بزنید):")
            prompt = input("> ").strip()
            if not prompt:
                print("لغو شد.")
                continue
            img_p = input("مسیر تصویر (اختیاری، Enter = بدون تصویر): ").strip()
            try:
                imgs = images_to_parts([img_p]) if img_p else None
                print("\n[…] در حال دریافت پاسخ…\n" + "-" * 55)
                DuckAI(proxy=args.proxy).ask(
                    prompt, model=model,
                    on_delta=lambda d: print(d, end="", flush=True),
                    images=imgs)
                print("\n")
            except Exception as e:
                print(f"[خطا] {e}")
            print("-" * 55)
        elif choice == "3":
            prompt = input("\nتوضیح تصویر: ").strip()
            if not prompt:
                print("لغو شد.")
                continue
            draw_once(DuckAI(proxy=args.proxy), prompt, model, out_dir)
            print("-" * 55)
        elif choice == "4":
            model = choose_model(model)
            print(f"مدل فعلی: {model}")
        elif choice == "5":
            try:
                import duck_voice as dv
                dv.run_live(DuckAI(proxy=args.proxy), model)
            except Exception as e:
                print(f"[خطا] {e}")
            print("-" * 55)
        elif choice == "6":
            try:
                import duck_voice as dv
                src_ = input("مسیر فایل صوتی (Enter = ضبط از میکروفون): ").strip().strip('"')
                c2 = DuckAI(proxy=args.proxy)
                if src_:
                    text = dv.transcribe_file(c2, src_, model)
                else:
                    text = dv.record_and_transcribe(c2, model)
                print(f"\nمتن:\n{text}\n")
                if input("ارسال به چت؟ (y/n): ").strip().lower() == "y":
                    print("\n[…] در حال دریافت پاسخ…")
                    c2.ask(text, model=model,
                           on_delta=lambda d: print(d, end="", flush=True))
                    print()
            except Exception as e:
                print(f"[خطا] {e}")
            print("-" * 55)
        else:
            print("گزینه معتبر وارد کنید.")


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\n\nبرنامه متوقف شد.")
