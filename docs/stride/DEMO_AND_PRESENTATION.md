# DropMesh — STRIDE demonstration script and presentation outline

**Status:** Preparation materials only. No demonstration or evaluator approval is claimed.

## Before recording

1. Test from a HTTPS frontend and WSS signaling server if available; never use passwords or personal documents as test files.
2. Confirm `npm test`, `npm run build` and `npm audit --audit-level=high` on a current commit; keep outputs.
3. Use a small sample text file you own, e.g. `stride-test.txt`.
4. Open sender and receiver browsers; create a fresh room code.
5. Record the screen and capture a dated browser URL and build information.
6. Capture real evidence of a completed transfer, receiver consent, SHA-256 verification and errors/limits.

## Five-minute demo outline

- **00:00–00:40 — Problem:** cross-device transfer friction, no unnecessary accounts for a basic test.
- **00:40–01:15 — Solution:** DropMesh pairing UI, room code and QR link.
- **01:15–02:20 — Live test:** create room, join from receiver, select test file, show approval prompt, download.
- **02:20–03:00 — Verification:** show file size/SHA-256 match and explain what it does *not* guarantee.
- **03:00–03:40 — Engineering:** React/Vite frontend, WebSocket signaling, WebRTC data channel, test structure.
- **03:40–04:20 — Responsible limitations:** no authenticated peer identity, no TURN guarantee, unresolved audit findings.
- **04:20–05:00 — Next steps and evaluator feedback:** security updates, broader testing, user feedback.

## Suggested eight-slide presentation

1. Title, student details, institution, GitHub link.
2. Problem and users.
3. Proposed approach and unique design choices.
4. Architecture: sender -> signaling for negotiation -> WebRTC peer data.
5. Implementation and screenshots (real screenshots only).
6. Actual tests and evidence (include failing audit finding honestly).
7. Limitations and roadmap.
8. Demo outcome, what was learned, questions and references.

## Demonstration verification record (complete after event)

- Date/time:
- Venue/event:
- Organizer or evaluator:
- Evaluator role:
- Actual demo URL:
- Features tested:
- Result and notes:
- Suggestions/feedback:
- Screenshot/video proof:
- Name/signature or verifiable email:

**Warning:** A self-made record is not a substitute for independent event or industry-expert verification.
