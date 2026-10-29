export const MAX_FILE = 100 * 1024 * 1024;
export const CHUNK_SIZE = 16 * 1024;
export const MAX_BUFFERED = 256 * 1024;
export const ROOM_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const ROOM_LENGTH = 12;
export type FileMeta = { type: 'meta'; id: string; name: string; size: number; mime: string; sha256: string };

export function isValidCode(value: string): boolean {
  return value.length === ROOM_LENGTH && [...value].every(char => ROOM_ALPHABET.includes(char));
}
export function parseMeta(value: unknown): FileMeta | null {
  if (!value || typeof value !== 'object') return null;
  const obj = value as Record<string, unknown>;
  if (obj.type !== 'meta' || typeof obj.id !== 'string' || !/^[a-f0-9]{32}$/.test(obj.id)) return null;
  if (typeof obj.name !== 'string' || !obj.name.trim() || obj.name.length > 160 || /[\\/\x00-\x1f\x7f\u202a-\u202e\u2066-\u2069]/.test(obj.name)) return null;
  if (typeof obj.size !== 'number' || !Number.isSafeInteger(obj.size) || obj.size < 0 || obj.size > MAX_FILE) return null;
  if (typeof obj.mime !== 'string' || obj.mime.length > 120) return null;
  if (typeof obj.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(obj.sha256)) return null;
  return obj as FileMeta;
}
export function pairingUrl(pageUrl: string, room: string): string {
  if (!isValidCode(room)) throw new Error('Invalid room code');
  const url = new URL(pageUrl);
  url.search = '';
  url.hash = new URLSearchParams({ pair: room }).toString();
  return url.toString();
}
export function codeFromHash(hash: string): string | null {
  const params = new URLSearchParams(hash.replace(/^#/, ''));
  const code = params.get('pair');
  return code && isValidCode(code) ? code : null;
}
export function sanitizeFileName(name: string): string {
  return name.replace(/[\\/\x00-\x1f\x7f\u202a-\u202e\u2066-\u2069]/g, '_').trim().slice(0, 160).replace(/^_+$/, '') || 'unnamed-file';
}
export function humanSize(bytes: number): string {
  return bytes < 1024 ? `${bytes} B` : bytes < 1048576 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1048576).toFixed(1)} MB`;
}
export async function sha256Hex(data: Blob): Promise<string> {
  if (!globalThis.crypto?.subtle) throw new Error('SHA-256 requires a secure browser context (HTTPS or localhost).');
  const digest = await globalThis.crypto.subtle.digest('SHA-256', await data.arrayBuffer());
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

/** Verify sender-advertised size and SHA-256 against received bytes before exposing a download. */
export async function verifyReceivedParts(parts: BlobPart[], meta: FileMeta): Promise<Blob> {
  const blob = new Blob(parts, { type: meta.mime || 'application/octet-stream' });
  if (blob.size !== meta.size) throw new Error('File size mismatch; rejected incomplete or extra data.');
  const actual = await sha256Hex(blob);
  if (actual !== meta.sha256) throw new Error('SHA-256 mismatch; corrupted file rejected.');
  return blob;
}
