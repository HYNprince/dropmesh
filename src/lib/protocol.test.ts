import { describe, expect, it } from 'vitest';
import { codeFromHash, isValidCode, pairingUrl, parseMeta, sanitizeFileName, sha256Hex, verifyReceivedParts, MAX_FILE } from './protocol';

const valid = { type: 'meta' as const, id: 'a'.repeat(32), name: 'example.txt', mime: 'text/plain', size: 3, sha256: 'f'.repeat(64) };
describe('pairing', () => {
  it('accepts 12-character high-entropy room strings', () => {
    expect(isValidCode('ABCDEFGHJKLM')).toBe(true);
    expect(isValidCode('123')).toBe(false);
    expect(isValidCode('AAAAAAAAAAA0')).toBe(false);
  });
  it('places bearer code in URL fragment, not query or path', () => {
    const url = pairingUrl('https://dropmesh.example/?utm=foo', 'ABCDEFGHJKLM');
    expect(url).toBe('https://dropmesh.example/#pair=ABCDEFGHJKLM');
    expect(codeFromHash(new URL(url).hash)).toBe('ABCDEFGHJKLM');
    expect(codeFromHash('#pair=BAD')).toBeNull();
  });
});
describe('file metadata validation', () => {
  it('accepts a valid envelope', () => expect(parseMeta(valid)).toEqual(valid));
  it.each([
    { ...valid, sha256: 'not-a-hash' },
    { ...valid, size: MAX_FILE + 1 },
    { ...valid, size: -1 },
    { ...valid, size: 1.4 },
    { ...valid, id: '../abc' },
    { ...valid, name: 'evil\nheader' },
    { ...valid, name: '' },
  ])('rejects an invalid envelope', bad => expect(parseMeta(bad)).toBeNull());
});
describe('SHA-256', () => {
  it('matches the known digest for abc', async () => {
    expect(await sha256Hex(new Blob(['abc']))).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
  it('changes when file content changes', async () => {
    expect(await sha256Hex(new Blob(['abc']))).not.toBe(await sha256Hex(new Blob(['abd'])));
  });
  it('hashes empty files', async () => {
    expect(await sha256Hex(new Blob([]))).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  });
});

describe('receiver integrity acceptance', () => {
  it('accepts correct chunked data', async () => {
    const meta = { ...valid, sha256: 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad' };
    const file = await verifyReceivedParts([new Blob(['a']), new Blob(['bc'])], meta);
    expect(await file.text()).toBe('abc');
  });
  it('rejects modified data and truncated data', async () => {
    const meta = { ...valid, sha256: 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad' };
    await expect(verifyReceivedParts([new Blob(['abd'])], meta)).rejects.toThrow('SHA-256 mismatch');
    await expect(verifyReceivedParts([new Blob(['ab'])], meta)).rejects.toThrow('File size mismatch');
  });
  it('sanitizes file names', () => {
    expect(sanitizeFileName('folder/a.txt')).toBe('folder_a.txt');
  });
});
