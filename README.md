<div align="center">

# 🦆 DuckAI Chat Studio

### *The free, ChatGPT-style web client for DuckDuckGo AI Chat — no API key, no signup.*

[![License: MIT](https://img.shields.io/badge/license-MIT-22c55e?style=flat-square)](LICENSE)
[![Next.js 15](https://img.shields.io/badge/Next.js-15-black?style=flat-square&logo=next.js&logoColor=white)](https://nextjs.org)
[![React 19](https://img.shields.io/badge/React-19-149eca?style=flat-square&logo=react&logoColor=white)](https://react.dev)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-3178c6?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![Stars](https://img.shields.io/github/stars/DarkBytee/DuckAiChat?style=flat-square&color=facc15)](https://github.com/DarkBytee/DuckAiChat/stargazers)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-8b5cf6?style=flat-square)](https://github.com/DarkBytee/DuckAiChat/pulls)

**[English](#-english) · [فارسی](#-فارسی)**

<br>

<img src="docs/screenshot-chat.png" alt="DuckAI Chat Studio — live streaming chat with GPT-6 Luna" width="860">

*Live streaming chat · GPT-6 Luna answering with a rendered Markdown table · Dark RTL UI*

<br>

**9 free models · Streaming markdown · Vision · Image generation · Voice · Council mode**

</div>

---

<a id="-english"></a>

## 🇬🇧 English

[DuckDuckGo AI Chat](https://duck.ai) gives everyone free access to premium models — but only inside a minimal web page. **DuckAI Chat Studio** wraps it in a full chat experience: token-by-token streaming, rich markdown, image understanding, image creation, voice, and multi-model "council" debates — behind a clean, RTL-friendly interface.

> [!TIP]
> **Zero configuration.** Clone it, install it, run it. The only *optional* key is a Gemini fallback for when duck.ai is unreachable — see [Environment variables](#-environment-variables).

---

### ✨ Features

| | Feature | What you get |
|:---:|---|---|
| 💬 | **9 free models** | GPT-6 Luna, Claude Haiku 5.5/4.5, Gemma 4, GPT-OSS 120B, Mistral & more — switch **mid-conversation**, history follows |
| ⚡ | **Real streaming** | Token-by-token SSE pipeline rendered live as Markdown (tables, code blocks, lists) |
| 👁 | **Vision** | Drop in any image — auto-converted to WebP ≤ 1568 px, white-flattened, payload-optimized via `sharp` |
| 🎨 | **Image generation** | `/draw` with 1K / 2K / 4K tiers, 5 aspect ratios, Lanczos upscale + unsharp masking server-side |
| 📄 | **File analysis** | Attach code & text files (40+ extensions) — truncated gracefully at 60K chars and injected into the prompt |
| 🏛 | **Council mode** | Three models answer the same prompt, then **synthesize** or **debate** each other |
| 🎙 | **Voice** | Live voice conversation (`/live`) + speech-to-text dictation |
| ⌨️ | **Slash commands** | `/model`, `/draw`, `/council`, `/live`, `/clear`, `/help`… |
| 🗂 | **History & theming** | Chats persist in `localStorage`, rename/delete, dark & light themes, full RTL |

---

### 🤖 Available models

| Model | Alias | Provider | Vision | Draw |
|---|:---|---|:---:|:---:|
| **GPT-6 Luna** | `luna` | OpenAI | ✓ | ✓ |
| **GPT-5.6 Luna** | `gpt-5.6-luna` | OpenAI | ✓ | ✓ |
| **GPT-5.4 Mini** | `mini` | OpenAI | ✓ | ✓ |
| **GPT-5.4 Nano** | `nano` | OpenAI | ✓ | — |
| **Claude Haiku 5.5** | `haiku-5.5` | Anthropic | ✓ | — |
| **Claude Haiku 4.5** | `haiku` | Anthropic | ✓ | — |
| **Gemma 4 31B** | `gemma` | Google · Tinfoil | ✓ | — |
| **GPT-OSS 120B** | `gpt-oss` | OpenAI · Tinfoil | — | — |
| **Mistral Small 4** | `mistral` | Mistral AI | — | — |

> [!NOTE]
> Model names/aliases come straight from `lib/duck-protocol.ts`. If duck.ai rotates its lineup, that single file is the only thing to update.

---

### ⌨️ Slash commands

| Command | Action |
|---|---|
| `/help` | Show the in-app help panel |
| `/model <name>` | Switch model mid-chat — e.g. `/model haiku-5.5` |
| `/draw <prompt>` | Force image generation (overrides auto-detection) |
| `/council <prompt>` | Ask three models at once, then synthesize/debate |
| `/live` · `/voice` | Open the live voice conversation |
| `/clear` | Start a fresh conversation |
| `/exit` | Same as `/clear` |

**Keyboard:** <kbd>Enter</kbd> = newline · <kbd>Ctrl</kbd>/<kbd>⌘</kbd> + <kbd>Enter</kbd> = send

---

### 🚀 Getting started

**Prerequisites:** [Node.js](https://nodejs.org) **20+** and npm.

```bash
# 1 · Clone
git clone https://github.com/DarkBytee/DuckAiChat.git
cd DuckAiChat

# 2 · Install
npm install

# 3 · Run
npm run dev
```

Open **http://localhost:3000** — that's it. No API keys, no accounts, no config.

> [!WARNING]
> If npm blocks native install scripts (Tailwind oxide, sharp, re2…), approve them once, then rebuild:
>
> ```bash
> npm install-scripts approve @tailwindcss/oxide re2 sharp
> npm rebuild
> ```

**Production:**

```bash
npm run build   # uses output: 'standalone' → self-contained server
npm start
```

**Deploy under a sub-path** (e.g. `https://example.com/chatai`):

```bash
NEXT_PUBLIC_BASE_PATH=/chatai npm run build
```

### ☁️ One-click deploy

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/DarkBytee/DuckAiChat)

Click the button and Render reads the `render.yaml` blueprint in this repo — installs, builds (Next.js standalone output) and hosts it. A few notes:

- **Free plan** — the instance sleeps after ~15 minutes of inactivity and wakes on the first request.
- **`GEMINI_API_KEY`** — the deploy wizard asks for it; you can leave it **empty** (it's only the optional fallback).
- **⚠️ Blocked egress IPs** — some clouds (including Render/AWS) have IP ranges duck.ai refuses at the network level; replies then fail with `[fetch failed]`. Fix: set `DUCK_PROXY` to an HTTP(S) proxy, or `GEMINI_API_KEY` for fallback mode.
- Every push to `main` auto-deploys.

---

### 🧠 Architecture

```mermaid
flowchart LR
    UI["🌐 Browser<br/>Next.js + React UI"] -->|"NDJSON stream"| API["⚙️ /api/duckchat<br/>Route Handler"]
    API -->|"1 · bootstrap"| DUCK["🦆 duck.ai"]
    API -->|"2 · challenge x-vqd-hash-1"| SOLVER["🔒 jsdom sandbox<br/>challenge solver"]
    SOLVER -->|"proof"| API
    API -->|"3 · SSE stream"| CHAT["📡 /duckchat/v1/chat"]
    CHAT -->|"deltas · tool calls · images"| API
    API -.->|"optional fallback"| GEM["✨ Gemini"]
```

1. **Bootstrap** — the server fetches `duck.ai` and reads the current front-end version.
2. **Challenge** — duck.ai responds with an anti-bot challenge in the `x-vqd-hash-1` header.
3. **Solve** — a sandboxed `jsdom` environment executes the challenge and produces a proof.
4. **Stream** — the route posts to `/duckchat/v1/chat`, proxies the SSE stream, parses events (message deltas, tool calls, generated images) and re-emits them as NDJSON the browser understands.

The handshake result is cached in memory and only refreshed when duck.ai rotates the challenge — repeated messages stay fast.

---

### 🎨 Image generation presets

| Quality | 1:1 | 16:9 | 9:16 | 4:3 | 3:4 |
|:---:|---:|---:|---:|---:|---:|
| **1K** | 1024×1024 | 1360×768 | 768×1360 | 1152×864 | 864×1152 |
| **2K** | 2048×2048 | 2560×1440 | 1440×2560 | 2048×1536 | 1536×2048 |
| **4K** | 3840×3840 | 3840×2160 | 2160×3840 | 3840×2880 | 2880×3840 |

Every generated image is upscaled with Lanczos and sharpened server-side before it reaches the chat.

---

### ⚙️ Environment variables

| Variable | Required | Description |
|---|:---:|---|
| — | — | **Nothing.** The app runs out of the box. |
| `GEMINI_API_KEY` | optional | Google Gemini key, used only as an automatic fallback (chat + image generation) when duck.ai is unreachable |
| `DUCK_PROXY` | optional | HTTP/HTTPS proxy URL (e.g. `http://user:pass@host:port`) used for duck.ai requests. Needed on hosts whose datacenter IPs duck.ai blocks. |
| `NEXT_PUBLIC_BASE_PATH` | optional | Base path when deploying under a sub-path (e.g. `/chatai`) |
| `APP_URL` | optional | Public URL of your deployment, used for self-referential links |

Copy `.env.example` → `.env.local` if you want to set any of these.

---

### 📁 Project structure

```
app/
├── api/duckchat/          # Chat proxy — handshake, challenge, SSE → NDJSON
├── api/duckvoice/         # Live voice & dictation endpoints
│   ├── dictation/
│   └── session/
├── layout.tsx             # Root layout (RTL, fonts, theme)
└── page.tsx               # Main chat UI
components/
├── chat-composer.tsx      # Input area, attachments, slash commands
├── chat-message-list.tsx  # Streaming message rendering (markdown)
├── chat-sidebar.tsx       # History, rename, delete
├── model-switcher.tsx     # Model picker
├── live-voice-modal.tsx   # Voice mode
└── …
lib/
├── duck-protocol.ts       # Pure protocol layer — models, request builder, SSE parser
├── webp-converter.ts      # Client-side image conversion
└── duck-protocol.test.ts  # Protocol tests
```

---

### 🩺 Troubleshooting

<details>
<summary><b>Click to expand</b></summary>

| Problem | Fix |
|---|---|
| «سرور در حال حاضر پاسخگو نیست» | duck.ai is unreachable from your server or rotated its challenge — retry, and check the server console. |
| 403 / challenge errors | duck.ai changed its anti-bot scheme. Open an issue — the solver may need an update. |
| duck.ai unavailable in your region | Deploy on a server in a supported region — all requests are made **server-side**, never from your browser. |
| Every message fails with `[fetch failed]` on a cloud host | duck.ai blocks many datacenter IP ranges at the network level. Set `DUCK_PROXY` (HTTP/HTTPS proxy) — or `GEMINI_API_KEY` as a pure fallback. |
| Native module errors during install | Approve install scripts (see [Getting started](#-getting-started)) then `npm rebuild`. |
| Images fail to upload | They are re-encoded server-side with `sharp`; make sure its native binary installed correctly. |

</details>

---

### 🗺 Roadmap

- [x] One-click deploy to Render (`render.yaml`)
- [ ] Docker image
- [ ] Optional password protection for public deployments
- [ ] Chat export/import (Markdown & JSON)
- [ ] Search across chat history
- [ ] Syntax highlighting for code blocks
- [ ] PDF attachment support
- [ ] Multi-language UI (English / فارسی)
- [ ] PWA — installable on mobile

---

### ⚠️ Disclaimer

> [!IMPORTANT]
> This is an **unofficial** client — **not affiliated with or endorsed by DuckDuckGo.** It interacts with the public duck.ai service for personal and educational use. Use responsibly: no spam, no abuse. Model availability and the service itself belong to DuckDuckGo and can change or disappear at any time.

### 🤝 Contributing

Pull requests are welcome! For major changes, please open an issue first to discuss what you'd like to change.

1. Fork the repo
2. Create your branch (`git checkout -b feature/amazing-feature`)
3. Commit (`git commit -m 'Add amazing feature'`)
4. Push (`git push origin feature/amazing-feature`)
5. Open a Pull Request

---

<a id="-فارسی"></a>

## 🇮🇷 فارسی

<div dir="rtl">

**DuckAI Chat Studio** کلاینت وب کامل و رایگان برای [چت هوش مصنوعی DuckDuckGo](https://duck.ai) با ظاهری شبیه ChatGPT است — بدون API Key، بدون ثبت‌نام.

<div align="center">

**۹ مدل رایگان · استریم زنده · بینایی · تولید تصویر · صوت · حالت شورا**

</div>

### ✨ قابلیت‌ها

| | قابلیت | توضیح |
|:---:|---|---|
| 💬 | **۹ مدل رایگان** | GPT-6 Luna، Claude Haiku، Gemma 4، GPT-OSS 120B، Mistral و… — سوییچ وسط گفتگو |
| ⚡ | **استریم واقعی** | پاسخ توکن‌به‌توکن با رندر زندهٔ Markdown (جدول، بلوک کد، لیست) |
| 👁 | **بینایی** | ارسال هر تصویری — تبدیل خودکار به WebP ≤ ۱۵۶۸px با `sharp` |
| 🎨 | **تولید تصویر** | `/draw` با کیفیت 1K/2K/4K، ۵ نسبت ابعاد، بزرگ‌نمایی و شارپ‌سازی سمت سرور |
| 📄 | **تحلیل فایل** | پیوست فایل کد و متن (بیش از ۴۰ پسوند) با برش هوشمند در ۶۰ هزار کاراکتر |
| 🏛 | **حالت شورا** | سه مدل هم‌زمان پاسخ می‌دن، بعد جمع‌بندی یا مناظره |
| 🎙 | **صوت** | مکالمهٔ صوتی زنده (`/live`) + دیکتهٔ گفتاری |
| ⌨️ | **دستورات اسلش** | `/model`، `/draw`، `/council`، `/live`، `/clear`، `/help` |
| 🗂 | **تاریخچه و تم** | ذخیره در `localStorage`، تغییر نام/حذف، تم روشن و تیره، RTL کامل |

### 🤖 مدل‌ها

| مدل | Alias | ارائه‌دهنده | بینایی | تولید تصویر |
|---|:---|---|:---:|:---:|
| **GPT-6 Luna** | `luna` | OpenAI | ✓ | ✓ |
| **GPT-5.6 Luna** | `gpt-5.6-luna` | OpenAI | ✓ | ✓ |
| **GPT-5.4 Mini** | `mini` | OpenAI | ✓ | ✓ |
| **GPT-5.4 Nano** | `nano` | OpenAI | ✓ | — |
| **Claude Haiku 5.5** | `haiku-5.5` | Anthropic | ✓ | — |
| **Claude Haiku 4.5** | `haiku` | Anthropic | ✓ | — |
| **Gemma 4 31B** | `gemma` | Google · Tinfoil | ✓ | — |
| **GPT-OSS 120B** | `gpt-oss` | OpenAI · Tinfoil | — | — |
| **Mistral Small 4** | `mistral` | Mistral AI | — | — |

### ⌨️ دستورات

| دستور | کار |
|---|---|
| `/help` | نمایش راهنما |
| `/model <name>` | تغییر مدل وسط چت — مثال: `/model haiku-5.5` |
| `/draw <prompt>` | تولید تصویر اجباری |
| `/council <prompt>` | پرسش هم‌زمان از سه مدل + جمع‌بندی/مناظره |
| `/live` | مکالمهٔ صوتی زنده |
| `/clear` · `/exit` | گفتگوی جدید |

**میانبرها:** <kbd>Enter</kbd> = خط جدید · <kbd>Ctrl</kbd>/<kbd>⌘</kbd> + <kbd>Enter</kbd> = ارسال

### 🚀 راه‌اندازی

پیش‌نیاز: **Node.js نسخه ۲۰ یا بالاتر**

<div dir="ltr">

```bash
git clone https://github.com/DarkBytee/DuckAiChat.git
cd DuckAiChat
npm install
npm run dev
```

</div>

بعد باز کن: **http://localhost:3000** — همین! هیچ کلید یا اکانتی لازم نیست.

> [!WARNING]
> اگر npm اسکریپت‌های نیتیو را بلاک کرد:
>
> ```bash
> npm install-scripts approve @tailwindcss/oxide re2 sharp
> npm rebuild
> ```

**بیلد پروداکشن:** `npm run build` سپس `npm start`
**انتشار زیر زیرمسیر:** `NEXT_PUBLIC_BASE_PATH=/chatai npm run build`

### ☁️ دپلوی با یک کلیک

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/DarkBytee/DuckAiChat)

دکمهٔ بالا رو بزن — Render فایل `render.yaml` این ریپو رو می‌خونه و خودش نصب، بیلد (خروجی standalone نکست) و هاست رو انجام میده:

- **پلن رایگان** — بعد از ~۱۵ دقیقه بی‌فعالیتی می‌خوابه و با اولین درخواست بیدار میشه
- **`GEMINI_API_KEY`** — توی ویزارد دپلوی می‌پرسه؛ می‌تونی **خالی بذاری** (فقط فال‌بک اختیاریه)
- **⚠️ بلاک‌شدن IP سرور** — duck.ai خیلی از IPهای دیتاسنتر (از جمله Render/AWS) رو در سطح شبکه می‌بنده و پیام‌ها با `[fetch failed]` خطا میدن. راه‌حل: `DUCK_PROXY` رو با یه پروکسی HTTP(S) پر کن، یا `GEMINI_API_KEY` رو برای حالت جایگزین بذار
- هر پوش به `main` خودکار دپلای میشه

### 🧠 معماری

```mermaid
flowchart LR
    UI["🌐 مرورگر<br/>Next.js + React"] -->|"استریم NDJSON"| API["⚙️ /api/duckchat"]
    API -->|"۱ · بوت‌استرپ"| DUCK["🦆 duck.ai"]
    API -->|"۲ · چالش x-vqd-hash-1"| SOLVER["🔒 حل‌گر در jsdom"]
    SOLVER -->|"اثبات"| API
    API -->|"۳ · استریم SSE"| CHAT["📡 /duckchat/v1/chat"]
    CHAT -->|"دلتاها · ابزارها · تصاویر"| API
    API -.->|"فال‌بک اختیاری"| GEM["✨ Gemini"]
```

نتیجهٔ هندشیک در حافظه کش می‌شود و فقط وقتی duck.ai چالش را عوض کند دوباره گرفته می‌شود.

### ⚙️ متغیرهای محیطی

| متغیر | اجباری؟ | توضیح |
|---|:---:|---|
| — | — | **هیچ‌چیز.** اپ بدون تنظیمات اجرا می‌شود. |
| `GEMINI_API_KEY` | اختیاری | فقط وقتی duck.ai در دسترس نباشد به‌عنوان جایگزین خودکار استفاده می‌شود |
| `DUCK_PROXY` | اختیاری | آدرس پروکسی HTTP/HTTPS (مثل `http://user:pass@host:port`) برای درخواست‌های duck.ai — روی سرورهایی که IP دیتاسنترشان بلاک است لازم می‌شود |
| `NEXT_PUBLIC_BASE_PATH` | اختیاری | انتشار زیر زیرمسیر مثل `/chatai` |
| `APP_URL` | اختیاری | آدرس عمومی دیپلای |

### ⚠️ سلب مسئولیت

> [!IMPORTANT]
> این پروژه یک کلاینت **غیررسمی** است و **هیچ وابستگی‌ای به DuckDuckGo ندارد**. فقط برای استفادهٔ شخصی و آموزشی ساخته شده. لطفاً مسئولانه استفاده کنید — اسپم نزنید و سوءاستفاده نکنید. دسترسی مدل‌ها و خود سرویس متعلق به DuckDuckGo است و ممکن است هر زمان تغییر کند یا قطع شود.

</div>

---

<div align="center">

**⭐ اگر این پروژه به دردت خورد، یه ستاره بده!**

ساخته‌شده با 🦆 و ☕ · [MIT License](LICENSE)

</div>
