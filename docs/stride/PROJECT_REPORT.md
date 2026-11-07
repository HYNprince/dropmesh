# DropMesh — STRIDE innovation project report (DRAFT)

**Student:** V. Gokulbalaji  
**Programme:** B.E. Computer Science and Engineering, Year I  
**Institution:** KPR Institute of Engineering and Technology  
**Academic year:** 2026–2027  
**Repository:** https://github.com/HYNprince/dropmesh  
**Project status:** Source-code prototype reviewed. Public deployment and live cross-device transfer require independent evidence.

> Evidence standard: Do not submit this draft as proof of a live deployment, security audit, user testing or faculty demonstration until the corresponding evidence has been added.

## 1. Problem statement

Sharing a file between devices can require an account, a cloud-upload step or a platform-specific service. DropMesh explores consent-based browser-to-browser file transfers using a short pairing code or QR link. This is a **prototype**, not a production secure-file-transfer service.

## 2. Project objectives

- Create browser pairing using a 12-character room code and QR link.
- Use a WebSocket signaling server to negotiate a WebRTC connection.
- Request receiver acceptance before transfer.
- Check the received file size and a sender-supplied SHA-256 digest.
- Build a responsive interface and document limitations accurately.

## 3. Technical design

**Frontend:** React 18, TypeScript, Vite, CSS.  
**Signaling service:** Node.js and the `ws` WebSocket package.  
**File transport:** WebRTC data channel after signaling.  
**Integrity check:** Browser Web Crypto SHA-256.  
**Testing:** Native Node tests, Vitest, Node signaling-server tests, and a GitHub Actions workflow.

### Intended data flow

1. Sender creates a room; the signaling server generates a short-lived room code.
2. Recipient joins through the code or a QR pairing URL.
3. Peers negotiate WebRTC through WebSocket signaling.
4. Sender selects a file and announces metadata.
5. Recipient chooses whether to accept.
6. File chunks travel over the established WebRTC data channel.
7. Receiver checks file size and sender-advertised SHA-256 before offering a download.

The signaling server does not intentionally transport the file payload, but signaling availability and direct connectivity are separate concerns.

## 4. Implementation evidence reviewed on GitHub (7 Nov 2026)

- `src/main.tsx`: browser UI, connection/transfer state, pairing and consent behavior.
- `src/lib/protocol.ts`: validated file metadata, naming restrictions, room-code functions, SHA-256 verification and a 100 MiB file limit.
- `server/app.js`: signaling room management, allowed-origin checks, connection limits and WebSocket handling.
- `tests/protocol.native.test.mjs`: metadata, checksum, file size and pairing-code tests.
- `tests/server.test.js`: room creation, signaling, denied connections and rate-limit tests.
- `DEPLOY.md` and `SECURITY.md`: deployment checks and security limitations.

**CI observation:** The repository's 29 October 2026 GitHub Actions run passed tests and the build but failed `npm audit --audit-level=high`. The audit reported 6 findings (3 moderate, 1 high, 2 critical). This must be resolved and reverified before advertising a security-ready deployment. CI logs: https://github.com/HYNprince/dropmesh/actions/runs/40849119098

## 5. Limitations and future work

- Peer identity is not authenticated; the room code is a bearer secret.
- SHA-256 only detects mismatches with the sender-supplied digest; it does not scan for malware.
- No TURN relay is configured, so some networks may not connect.
- Receiver buffers the full file; a 100 MiB file cap remains.
- Cross-network phone tests, security review and long-duration reliability evidence are not yet attached.
- The repository README states deployment was not completed; the student reports a later deployment. **The live URL and independent test evidence must be attached to resolve this discrepancy.**

## 6. Demonstration procedure

Use only disposable, non-sensitive test files. On an allowed and verified test environment, open the app in two browsers/devices; create a room; join by code/QR; offer a small file; explicitly accept; confirm that the downloaded file matches the original. Then show a rejected/cancelled offer and an invalid room code. Capture dated screenshots/video without exposing private tokens.

## 7. Results log — complete with genuine evidence

| Item | Result | Evidence link / date |
|---|---|---|
| GitHub repository accessible | Confirmed | https://github.com/HYNprince/dropmesh |
| Test source files exist | Confirmed | Paths in Section 4 |
| CI tests/build on 29 Oct 2026 | Passed before audit gate | Run above |
| Security audit gate | Failed | Run above |
| Public frontend URL | Not independently verified | [add URL] |
| Live WSS signaling health | Not independently verified | [add URL and date] |
| Cross-device actual transfer | Not independently verified in this audit | [add video/test report] |
| Faculty/industry-expert presentation | Not evidenced | [add evaluator, date, proof] |
| Portal report upload | Not evidenced | [add receipt] |

## 8. STRIDE mapping (not a score award)

- **TRL-1 / 5 marks:** idea/concept documentation + GitHub README.
- **TRL-2 / 8 marks:** partial prototype + GitHub README.
- **TRL-3 / 12 marks:** substantial working prototype + basic report + GitHub README.
- **TRL-4 / 18 marks:** full prototype + documentation + demo video + presentation + report + README.
- **TRL-5 / 20 marks:** complete project demonstrated to a qualifying industry expert or college event and report uploaded to the portal.

The college evaluator determines accepted TRL and points. This draft fills only part of the documentary requirement; it does not itself prove TRL-4 or TRL-5.

## 9. Evidence attachments to obtain

- [ ] Link to actual deployed frontend and WSS health endpoint
- [ ] Dated desktop/mobile screenshots
- [ ] Original and received test-file SHA-256 comparison
- [ ] Video demo (3–5 minutes)
- [ ] Final slide presentation and final report approved by mentor
- [ ] Security issues evaluated and corrected, with passing CI
- [ ] Signed/emailed event or industry-expert demonstration evidence
- [ ] Final portal upload receipt

**Author's verification and faculty signature:** Pending.
