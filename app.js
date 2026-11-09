// ورودی Passenger (cPanel ← Setup Node.js App).
//
// دو حالت:
//  ۱) اگر `.next/standalone/server.js` هست (خروجی `next build` با output: 'standalone'،
//     بدون نیاز به node_modules کامل؛ برای هاست هایی که فضا یا CPU کم دارند)، همان اجرا می شود.
//  ۲) وگرنه Next.js با node_modules پروژه بالا می آید (بعد از `npm install` و `npm run build`).
// Passenger خودش listen را روی سوکت خودش می گذارد؛ PORT فقط برای اجرای دستی است.
const fs = require('fs');
const path = require('path');

const standalone = path.join(__dirname, '.next', 'standalone', 'server.js');

if (fs.existsSync(standalone)) {
  process.env.HOSTNAME = '0.0.0.0';
  process.env.PORT = process.env.PORT || '3000';
  require(standalone);
} else {
  const { createServer } = require('http');
  const next = require('next');

  const app = next({ dev: false, dir: __dirname });
  const handle = app.getRequestHandler();

  app.prepare().then(() => {
    createServer((req, res) => handle(req, res)).listen(process.env.PORT || 3000);
  }).catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
