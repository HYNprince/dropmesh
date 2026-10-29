import test from 'node:test';
import assert from 'node:assert/strict';
import {
  codeFromHash, isValidCode, pairingUrl, parseMeta, sanitizeFileName, sha256Hex, verifyReceivedParts, MAX_FILE,
} from '../src/lib/protocol.ts';

const abcDigest = 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad';
const emptyDigest = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
const sample = {type:'meta', id:'a'.repeat(32), name:'test.txt', size:3, mime:'text/plain', sha256:abcDigest};

test('pairing code validation and URL fragment behavior', () => {
  assert.equal(isValidCode('ABCDEFGHJKLM'), true);
  assert.equal(isValidCode('123456'), false);
  assert.equal(isValidCode('OABCDEFGHIJK'), false);
  const link = pairingUrl('https://dropmesh.example/share?ref=x', 'ABCDEFGHJKLM');
  assert.equal(link, 'https://dropmesh.example/share#pair=ABCDEFGHJKLM');
  assert.equal(codeFromHash(new URL(link).hash), 'ABCDEFGHJKLM');
  assert.equal(codeFromHash('#pair=123456'), null);
});

test('valid metadata accepted and invalid metadata rejected', () => {
  assert.deepEqual(parseMeta(sample), sample);
  for (const bad of [
    {...sample, id: '../etc'}, {...sample, name: 'bad\nname'},
    {...sample, name: ''}, {...sample, name:'a/b'}, {...sample, name:'a\u202eb'}, {...sample, size: -1}, {...sample, size: 1.3},
    {...sample, size: MAX_FILE+1}, {...sample, size: '3'},
    {...sample, sha256: 'oops'},
  ]) assert.equal(parseMeta(bad), null);
});

test('SHA-256 matches known values', async () => {
  assert.equal(await sha256Hex(new Blob(['abc'])), abcDigest);
  assert.equal(await sha256Hex(new Blob([])), emptyDigest);
});

test('whole file reconstructed from independent chunks passes integrity check', async () => {
  const file = await verifyReceivedParts([new Uint8Array([97, 98]), new Uint8Array([99])], sample);
  assert.equal(await file.text(), 'abc');
});

test('tampered bytes fail SHA-256 verification', async () => {
  await assert.rejects(verifyReceivedParts([new Blob(['abd'])], sample), /SHA-256 mismatch/);
});

test('truncated or expanded stream fails length validation', async () => {
  await assert.rejects(verifyReceivedParts([new Blob(['ab'])], sample), /File size mismatch/);
  await assert.rejects(verifyReceivedParts([new Blob(['abcd'])], sample), /File size mismatch/);
});

test('zero-byte file passes integrity verification', async () => {
  const empty = {...sample, size:0, sha256:emptyDigest};
  const file = await verifyReceivedParts([], empty);
  assert.equal(file.size, 0);
});

test('unsafe filename characters are sanitized before sending', () => {
  assert.equal(sanitizeFileName('folder/secret\\name.txt'), 'folder_secret_name.txt');
  assert.equal(sanitizeFileName('\u202e'), 'unnamed-file');
});
