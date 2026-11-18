# DropMesh beta — Security & disclosure

**This code is not security-audited. Do not transfer passwords, credentials, private identity documents or other sensitive data.**

## Guarantees and non-guarantees

- WebRTC data channels use secure DTLS transport. The signaling server is not the file store.
- SHA-256 checks integrity of the bytes against the hash provided by the remote participant. It does **not** identify or authenticate a person.
- Random 12-character codes are bearer secrets; QR codes and room links must be handled privately.
- The origin allowlist protects against unwanted browser origins but is not proof of peer identity.
- No guaranteed connection without credentialed TURN, and no file streaming for large files.

## Before deploying to strangers

- Add out-of-band peer identity/fingerprint verification or authenticated invite links with separate authorization.
- Configure TURN using short-lived credentials, HTTPS/WSS, HSTS and proper reverse proxy controls.
- Implement file streaming and size/memory protections for mobile clients; test with real phones.
- Run browser end-to-end tests and arrange a security review; add abuse reporting and resource budgets.
- Keep dependencies updated; pin the lockfile and run vulnerability scanning.

## Responsible testing

Only test with files you own or have explicit permission to send. Report security problems privately to the maintainers before disclosure. No contact address is bundled; add a monitored security contact before public release.

## v0.4 multi-file limitations

The batch selector limits 20 files, 100 MiB each, and 200 MiB total. The receiver caps
retained downloads in a session by count and total bytes. Every file receives individual
consent and independent size/digest verification. Inbound files are buffered and verified
download Blob URLs remain in memory until session reset. Large batches can stress mobile
memory; use harmless test data only. SHA-256 is not malware scanning or identity proof.
No browser-to-browser security or large-batch stress audit is claimed.
