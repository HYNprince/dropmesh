# DropMesh v0.3.1 — Comic UI + deployment preparation

A playful but functional browser-to-browser file-transfer MVP. **v0.3 redesigns the interface only**: room pairing, QR joins, direct WebRTC file transfer, receiver approval, and SHA-256 integrity verification are inherited from the working v0.2 code. This release does **not** add multi-file transfer, resume, TURN relays, authenticated identity, or a public deployment.

## What's new in the interface

- Comic-pop visual system: cream paper, cobalt/purple typography, pink/lime/cyan panels, bold borders, offset shadows, halftone details and a CSS device illustration.
- Responsive landing page with clear transfer-flow hierarchy and playful (but functional) controls.
- QR enlargement modal (Escape key closes it); pairing-link and room-code copy feedback.
- Drag-over feedback; clearer receiving-consent UI; checksum and file-download success presentation.
- More explicit connection states, a small explanation of security limitations, and keyboard-focus styles.
- All decorative visuals are CSS/React; no external illustration assets required. Web fonts load from Google Fonts with system-font fallbacks.

## Public deployment

See [DEPLOY.md](DEPLOY.md) for the Mac security checks, GitHub push, Render WebSocket server setup, Vercel frontend setup, and cross-network phone test. This package has **not** been deployed yet.

## Requirements

Node.js 22.16+ and npm, a modern browser, and a secure context for Web Crypto (localhost or HTTPS). For testing on one Mac, use two browser tabs on the **same Mac**. The v0.3 frontend points to `ws://localhost:8787/signal` by default.

## Run on your Mac

**Stop the old v0.2 servers** with `Control + C` in both running Terminal windows, then extract this archive to `~/Downloads/dropmesh-v0.3`.

Terminal 1:

```bash
cd ~/Downloads/dropmesh-v0.3
npm install
cp .env.example .env
npm run signal
```

Terminal 2:

```bash
cd ~/Downloads/dropmesh-v0.3
npm run dev
```

Visit `http://localhost:5173` in Brave or Chrome. Open a second tab, create a room in the first, join via the code in the second, send a small non-sensitive file, accept it, verify the download. The page will not work by double-clicking `index.html`.

**Alternatively, if you wish to retain the v0.2 installation and its `node_modules`:** extract the separate `dropmesh-v0.3-ui-patch.zip` into your existing `dropmesh-v0.2` folder, replacing `src/main.tsx`, `src/style.css`, `index.html`, and `package.json`, then restart `npm run signal` and `npm run dev` as before. You do not need new dependencies for this UI update.

## Verification

- `npm run test:native`: protocol tests, works without installed dependencies.
- `npm run test:unit`, `npm run test:server`, `npm run build`: require dependencies.
- `npm audit`: dependency audit. The previous v0.2 Mac installation reported 6 vulnerabilities; this UI-only release does **not** resolve those automatically. Review transitive dependency advisories before public deployment. Avoid running `npm audit fix --force` blindly.

## Security and limitations

Room codes are **bearer secrets**, not peer identity verification. SHA-256 detects corruption relative to the digest advertised by the sender but **does not** guarantee that the sender is trustworthy or that the file is malware-free. The WebRTC data channel uses encrypted transport; QR links use a URL fragment to avoid placing the pairing code in URL query parameters. The signaling server never intentionally receives file payloads. Transfer size is capped at 100 MiB; the receiver buffers a full file in memory. TURN relay, cross-network reliability, browser E2E tests, and a security audit are still missing. **Do not use with sensitive files.**

Testing a real phone requires the app at a publicly trusted **HTTPS** address and signaling at **WSS** (and may need a TURN relay); scanning a `localhost` QR from a phone will not reach the Mac's localhost. A Vite LAN link is not usually a secure context for Web Crypto on a phone.

See `SECURITY.md` for release gating.

## Changes in v0.3.1 deployment candidate

- Explicit WSS signaling URL required by public build (no silent localhost fallback).
- Fail-fast production server origin allowlist checks and basic Vercel security headers.
- GitHub Actions switches to reproducible `npm ci` once the lockfile has been generated and committed on your Mac.
- Added production configuration example and preflight validation command.

