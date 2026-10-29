# Deploy DropMesh v0.3.1 — controlled public beta

> Do **not** announce a public launch until dependency audit, build, and cross-device tests pass. This code has not undergone a professional security audit. Use non-sensitive test files.

## 0. Mac preflight (project folder)

You must have Node 22.16+ and npm. This archive intentionally **does not** include `node_modules` or a lockfile, because dependency downloads are unavailable in the build environment. Generate the lockfile on your Mac.

```bash
cd ~/Downloads/dropmesh-v0.3-deploy-ready
npm install
npm run test:native
npm run test:unit
npm run test:server
npm audit --audit-level=high
npm audit --omit=dev --audit-level=high
```

**Stop** on an unresolved high/critical vulnerability. Inspect `npm audit` output. Update affected direct dependencies conservatively and retest; do not blindly use `npm audit fix --force`. Before production deployment, resolve reported high/critical advisories, including development dependencies used by CI/build.

Then check that the frontend actually builds against a valid WSS production URL (this example address is not a real server and is ONLY for a build test):

```bash
VITE_SIGNAL_URL=wss://example.invalid/signal npm run build
VITE_SIGNAL_URL=wss://example.invalid/signal npm run check:deploy
```

A passing build with a dummy URL does **not** prove live connectivity. Commit `package-lock.json` once dependency checks pass.

## 1. Publish to your own GitHub repository

Create a new EMPTY repository (for example `dropmesh`) on GitHub; do not initialize with README. In the project folder:

```bash
git init
git add .
git commit -m "chore: prepare DropMesh public beta"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/dropmesh.git
git push -u origin main
```

Replace `YOUR_USERNAME` with your real GitHub username. Sign in with your normal GitHub authentication if asked. Never commit `.env`, credentials, real private pairing codes, or `node_modules`. Check GitHub Actions; this repository's CI expects the generated `package-lock.json` and uses `npm ci`.

## 2. Render — signaling WebSocket service (deploy FIRST)

1. Go to https://dashboard.render.com/ and choose **New → Web Service**.
2. Connect the DropMesh GitHub repo and select the `main` branch.
3. Runtime **Node**. Root directory: repo root (leave blank).
4. **Build command:** `npm ci --omit=dev`
5. **Start command:** `npm run signal`
6. Select a plan for your pilot (Free is suitable for experiments but sleeps and is not reliable production hosting).
7. Environment variables: `NODE_ENV=production`, `ALLOWED_ORIGINS=https://example.invalid` TEMPORARILY (replace with your real Vercel origin in step 4). `PORT` is automatically provided by Render; the app reads it.
8. Health check path: `/health`.
9. Deploy. Note the actual Render hostname (e.g. `dropmesh-signal-XYZ.onrender.com`, which is an example, not a guaranteed name).
10. Verify `https://YOUR_RENDER_HOST/health` returns `{ "status": "ok" }`. The public WebSocket URL will be `wss://YOUR_RENDER_HOST/signal`.

Do not use `https://` as your browser WebSocket URL: it must start with `wss://`.

## 3. Vercel — comic React frontend

1. Go to https://vercel.com/new and import the **same** GitHub repository.
2. Framework preset **Vite** (or Other, if necessary). Root directory: repository root.
3. **Build command:** `npm run build`.
4. **Output directory:** `dist`.
5. Environment variable **VITE_SIGNAL_URL** set to `wss://YOUR_RENDER_HOST/signal`. It's public, not secret; never place passwords or TURN credentials in a `VITE_` variable.
6. Deploy and write down the exact `https://YOUR_VERCEL_DOMAIN` URL. The generated Vercel address is not known in advance.

`vercel.json` supplies some security headers. If you later add a custom domain, revisit the origin allowlist.

## 4. Finalize Render allowlist, then test

1. Render → signaling Web Service → **Environment**.
2. Set `ALLOWED_ORIGINS=https://YOUR_VERCEL_DOMAIN` (no trailing slash or path).
3. Save/redeploy/restart the Render service for environment changes to take effect.
4. Test `https://YOUR_RENDER_HOST/health` again.
5. On Mac, open `https://YOUR_VERCEL_DOMAIN`, create a room.
6. On phone, turn OFF Wi-Fi for a genuine separate-network test, scan the QR from the Mac, tap Join, and try a **small, non-sensitive** file. Accept and verify SHA-256 and download.
7. Test in both directions, disconnect midway, try a wrong room code, let a waiting room expire, and test Chrome/Brave/Safari as relevant.

If room creation fails, use browser developer tools → Network → WS and Render logs. Look for `403` (origin allowlist), `404` (wrong `/signal` path), `429` (rate limits), or failed WSS upgrade. Check the Vercel build variable and redeploy the frontend if you change it.

If pairing succeeds but WebRTC fails across networks, a **TURN relay with short-lived credentials** is the likely next infrastructure task. STUN-only is not universally reliable. A public WSS server alone does not guarantee P2P connectivity.

## Free-tier realities and release gates

- Render Free web services can spin down after inactivity; WebSocket activity is subject to provider behavior and limits. Suitable for prototypes, not guaranteed uptime.
- Vercel Hobby terms currently restrict use to personal, non-commercial projects. Check current terms before running a commercial service.
- Current code uses WebRTC secure channels but has **no peer identity authentication**. SHA-256 checks bytes against a sender-provided digest; it is not malware scanning.
- The receiver buffers the entire file. Prefer testing small files; do not promote large/mobile transfers until streaming and memory controls are implemented.
- No TURN and no browser-to-browser automated end-to-end suite yet.
- Re-run dependency audit and review security issues before inviting users or sharing sensitive data.
