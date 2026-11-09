# SABI CHAT deployment

Based on https://github.com/DarkBytee/DuckAiChat (MIT license retained in LICENSE). Original Next.js web app, branding changed to SABI CHAT. Removed firebase-tools and lint dependencies for production; declared sharp explicitly, set Next.js build CPUs to 1, and regenerated npm lockfile.

- Public URL: https://sabi-ai.sahebkarami.ir
- AWS Lightsail: existing sabi-ai-duck-ohio, us-east-2; static address 18.219.63.28.
- Service: systemd sabichat, unprivileged user, listens on 127.0.0.1:18082, memory limit 650M. Existing sabi-ai-duck service is separate.
- Node: /opt/sabichat-node (24.15.0); app: /opt/sabichat; output: .next/standalone.
- Nginx config /etc/nginx/sites-available/sabichat, limit zone /etc/nginx/conf.d/sabichat-limits.conf; Cloudflare proxied A record, SSL mode Full; self-signed per-host origin certificate, not Full (strict).
- For maintenance use Lightsail temporary SSH certificate, verify host key; port 22 is normally closed.
- Build: npm ci; npm run build; copy public to .next/standalone/public and .next/static to .next/standalone/.next/static; restart sabichat. Node 24.15+ required by lockfile. Build on a machine with adequate RAM and disk.
- /swap-sabichat 2 GiB enabled for build/runtime and configured in fstab for reboot persistence.
- No GEMINI_API_KEY or DUCK_PROXY configured. App relies on duck.ai and upstream rate limits/availability.
- Upstream executes duck.ai challenge code using jsdom, which is not a security sandbox; unprivileged service and systemd restrictions reduce but do not eliminate risk. Public API is rate- and connection-limited by Nginx, request body limit 16 MiB; no user authentication.
- This upstream repository may not include every custom modification of the friend's deployed site.

- Assistant identity: Sabi-AI (صابی ای‌ای) in chat requests and realtime voice instructions; underlying model/provider remain unchanged. Model instructions are best-effort, not a guarantee.
- Simple standalone name/self-introduction questions receive a local branded response; complex requests still go to the chosen model, so upstream identity instructions can take priority.

- Public branding and assistant name are SABI-AI. Composer credit uses a red CSS heartbeat with reduced-motion support and a highlighted Persian creator signature.

## Domain migration 2026-11-09
- Public canonical URL https://sabi-ai.sahebkarami.ir; the former https://sabichat.sahebkarami.ir redirects to it (HTTP 308). New site Nginx /etc/nginx/sites-available/sabichat, certificate /etc/nginx/sabi-ai-new; allowed Origin https://sabi-ai.sahebkarami.ir. Old app is now https://chat.sahebkarami.ir. Browser storage is per-hostname and does not automatically migrate.

- Home and sidebar have iridescent SABI-AI marks. A five-second full-screen black welcome celebration plays on every page load and whenever a new conversation is created, then fades out to reveal the chat. Reduced-motion is respected.

- Glowing pink and mint points orbit their elliptical logo lines in opposite directions in both main and sidebar logos, with reduced-motion support.
