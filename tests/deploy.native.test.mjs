import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
const command = new URL('../scripts/check-deploy.mjs', import.meta.url).pathname;
function check(value) {
  const env = { ...process.env, VITE_SIGNAL_URL: value };
  const result = spawnSync(process.execPath, [command], { env, encoding: 'utf8' });
  return result;
}
test('production WSS signaling endpoint is accepted', () => {
  const result = check('wss://signal.example.test/signal');
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /PASS/);
});
test('localhost and unencrypted WebSockets are rejected for production', () => {
  for (const value of ['ws://localhost:8787/signal', 'wss://localhost/signal', 'https://example.test/signal']) {
    assert.notEqual(check(value).status, 0, value);
  }
});
test('WebSocket signaling path must be /signal', () => {
  assert.notEqual(check('wss://signal.example.test/').status, 0);
  assert.notEqual(check('wss://signal.example.test/signal?code=abc').status, 0);
});
