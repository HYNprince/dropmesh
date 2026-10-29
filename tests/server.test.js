import test from 'node:test';
import assert from 'node:assert/strict';
import { WebSocket } from 'ws';
import { createSignalingServer } from '../server/app.js';

const ORIGIN = 'http://localhost:5173';
async function setup(t, options = {}) {
  const app = createSignalingServer({ allowedOrigins: [ORIGIN], ...options });
  const address = await app.listen(0);
  t.after(async () => { await app.close(); });
  return { app, url: `ws://127.0.0.1:${address.port}/signal` };
}
async function connect(url, origin = ORIGIN) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url, { origin });
    ws.once('open', () => resolve(ws));
    ws.once('error', reject);
  });
}
function next(ws, type) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { ws.off('message', handler); reject(new Error(`Timed out waiting for ${type}`)); }, 1500);
    function handler(payload) {
      let msg;
      try { msg = JSON.parse(String(payload)); } catch { return; }
      if (msg.type === type) { clearTimeout(timer); ws.off('message', handler); resolve(msg); }
    }
    ws.on('message', handler);
  });
}
async function createRoom(ws) {
  const done = next(ws, 'room-created');
  ws.send(JSON.stringify({ type: 'create' }));
  return (await done).room;
}

test('server-generated room code has 12 safe characters', async t => {
  const { url } = await setup(t);
  const host = await connect(url);
  const room = await createRoom(host);
  assert.match(room, /^[A-HJ-NP-Z2-9]{12}$/);
});

test('host and one guest can pair and relay an SDP offer', async t => {
  const { url } = await setup(t);
  const host = await connect(url);
  const guest = await connect(url);
  const room = await createRoom(host);
  const hostReady = next(host, 'peer-ready');
  const guestReady = next(guest, 'peer-ready');
  const joined = next(guest, 'joined');
  guest.send(JSON.stringify({ type: 'join', room }));
  assert.equal((await joined).room, room);
  assert.equal((await hostReady).initiator, true);
  assert.equal((await guestReady).initiator, false);
  const forwarded = next(guest, 'signal');
  host.send(JSON.stringify({ type: 'signal', data: { type: 'offer', sdp: { type: 'offer', sdp: 'v=0' } } }));
  assert.deepEqual((await forwarded).data, { type: 'offer', sdp: { type: 'offer', sdp: 'v=0' } });
});

test('rejects unknown room codes and third connections', async t => {
  const { url } = await setup(t);
  const host = await connect(url), guest = await connect(url), third = await connect(url);
  const bad = next(guest, 'error');
  guest.send(JSON.stringify({ type: 'join', room: 'AAAAAAAAAAAA' }));
  assert.match((await bad).message, /unavailable/i);
  const room = await createRoom(host);
  const joined = next(guest, 'joined');
  guest.send(JSON.stringify({ type: 'join', room }));
  await joined;
  const error = next(third, 'error');
  third.send(JSON.stringify({ type: 'join', room }));
  assert.match((await error).message, /unavailable/i);
});

test('rejects signaling before joining, and invalid ICE data', async t => {
  const { url } = await setup(t);
  const host = await connect(url), guest = await connect(url);
  const bad = next(guest, 'error');
  guest.send(JSON.stringify({ type: 'signal', data: { type: 'candidate', candidate: { candidate: 'hi' } } }));
  assert.match((await bad).message, /invalid/i);
  await createRoom(host);
  const bad2 = next(host, 'error');
  host.send(JSON.stringify({ type: 'signal', data: { type: 'offer', sdp: { type: 'answer', sdp: 'v=0' } } }));
  assert.match((await bad2).message, /invalid/i);
});

test('origin allowlist blocks other websites and missing origin', async t => {
  const { url } = await setup(t);
  await assert.rejects(connect(url, 'https://malicious.example'));
  await assert.rejects(new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    ws.once('open', resolve);
    ws.once('error', reject);
  }));
});

test('enforces per-IP connection cap', async t => {
  const { url } = await setup(t, { maxConnectionsPerIp: 1 });
  const first = await connect(url);
  await assert.rejects(connect(url));
  first.close();
});

test('enforces per-socket message rate limit', async t => {
  const { url } = await setup(t, { maxMessagesPerMinute: 2 });
  const ws = await connect(url);
  await createRoom(ws);
  const response = next(ws, 'error');
  ws.send(JSON.stringify({ type: 'unknown' }));
  ws.send(JSON.stringify({ type: 'unknown' }));
  assert.match((await response).message, /too many/i);
});

test('notifies host when guest leaves and allows a new guest', async t => {
  const { url } = await setup(t);
  const host = await connect(url), guest = await connect(url);
  const room = await createRoom(host);
  const joined = next(guest, 'joined');
  guest.send(JSON.stringify({ type: 'join', room }));
  await joined;
  const left = next(host, 'peer-left');
  guest.close();
  await left;
  const secondGuest = await connect(url);
  const secondJoined = next(secondGuest, 'joined');
  secondGuest.send(JSON.stringify({ type: 'join', room }));
  assert.equal((await secondJoined).room, room);
});

test('host disconnect invalidates room for guest', async t => {
  const { url } = await setup(t);
  const host = await connect(url), guest = await connect(url);
  const room = await createRoom(host);
  const joined = next(guest, 'joined');
  guest.send(JSON.stringify({ type: 'join', room }));
  await joined;
  const leave = next(guest, 'host-left');
  host.close();
  await leave;
});

test('expired pairing room cannot be joined', async t => {
  const { url } = await setup(t, { roomTtlMs: 15 });
  const host = await connect(url), guest = await connect(url);
  const room = await createRoom(host);
  await new Promise(resolve => setTimeout(resolve, 45));
  const error = next(guest, 'error');
  guest.send(JSON.stringify({ type: 'join', room }));
  assert.match((await error).message, /expired|unavailable/i);
});

test('server rejects oversized SDP, rather than forwarding it', async t => {
  const { url } = await setup(t);
  const host = await connect(url), guest = await connect(url);
  const room = await createRoom(host);
  const joined = next(guest, 'joined');
  guest.send(JSON.stringify({ type: 'join', room }));
  await joined;
  const bad = next(host, 'error');
  host.send(JSON.stringify({ type: 'signal', data: { type: 'offer', sdp: { type: 'offer', sdp: 'a'.repeat(33000) } } }));
  assert.match((await bad).message, /invalid/i);
});
