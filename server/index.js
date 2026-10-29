import { createSignalingServer } from './app.js';

// Avoid an accidentally public signaling instance with a development origin allowlist.
if (process.env.NODE_ENV === 'production' && !process.env.ALLOWED_ORIGINS?.trim()) {
  throw new Error('Production requires ALLOWED_ORIGINS=https://your-vercel-domain (comma-separated exact origins).');
}
const origins = (process.env.ALLOWED_ORIGINS || 'http://localhost:5173,http://127.0.0.1:5173')
  .split(',').map(origin => origin.trim()).filter(Boolean);
if (process.env.NODE_ENV === 'production' && origins.some(origin => {
  try { const url = new URL(origin); return url.protocol !== 'https:' || url.origin !== origin; }
  catch { return true; }
})) throw new Error('ALLOWED_ORIGINS must contain exact HTTPS origins in production (no paths, no wildcard).');
const port = Number(process.env.PORT || 8787);
const app = createSignalingServer({ allowedOrigins: origins });
await app.listen(port, '0.0.0.0');
console.log(`DropMesh signaling running on port ${port}; allowed origins: ${origins.join(', ')}`);
for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => { app.close().then(() => process.exit(0)); });
}
