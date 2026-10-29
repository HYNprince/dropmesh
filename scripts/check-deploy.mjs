import fs from 'node:fs';

// Run with VITE_SIGNAL_URL=wss://your-render-service.onrender.com/signal npm run check:deploy
// or create .env.production with the same value (only public URLs; no credentials).
const envFile = fs.existsSync('.env.production') ? fs.readFileSync('.env.production', 'utf8') : '';
const match = envFile.match(/^\s*VITE_SIGNAL_URL\s*=\s*['"]?([^'"\r\n#]+)['"]?\s*$/m);
const endpoint = process.env.VITE_SIGNAL_URL || match?.[1]?.trim();
if (!endpoint) {
  console.error('FAIL: VITE_SIGNAL_URL not configured. Add it as a Vercel build environment variable.');
  process.exit(1);
}
let url;
try { url = new URL(endpoint); } catch { console.error('FAIL: Invalid VITE_SIGNAL_URL.'); process.exit(1); }
if (url.protocol !== 'wss:' || url.pathname !== '/signal' || url.search || url.hash ||
    ['localhost', '127.0.0.1', '0.0.0.0'].includes(url.hostname)) {
  console.error('FAIL: Production signaling must use wss://<host>/signal with no query, hash or localhost.');
  process.exit(1);
}
console.log('PASS: Signaling URL is a valid external WSS /signal endpoint.');
console.log('Reminder: set Render ALLOWED_ORIGINS to the exact HTTPS Vercel site origin.');
