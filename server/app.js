import { randomInt } from 'node:crypto';
import http from 'node:http';
import { WebSocket, WebSocketServer } from 'ws';

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const ROOM_LENGTH = 12; // ~60 bits of bearer-secret entropy
const ROOM_TTL_MS = 10 * 60_000;
const HEARTBEAT_MS = 30_000;

function makeCode() {
  return Array.from({ length: ROOM_LENGTH }, () => ALPHABET[randomInt(ALPHABET.length)]).join('');
}

function isValidCode(value) {
  return typeof value === 'string' && new RegExp(`^[${ALPHABET}]{${ROOM_LENGTH}}$`).test(value);
}

function isValidSignal(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return false;
  if (data.type === 'offer' || data.type === 'answer') {
    return data.sdp && typeof data.sdp === 'object' &&
      data.sdp.type === data.type && typeof data.sdp.sdp === 'string' &&
      data.sdp.sdp.length <= 32000;
  }
  if (data.type === 'candidate') {
    return data.candidate && typeof data.candidate === 'object' &&
      typeof data.candidate.candidate === 'string' &&
      data.candidate.candidate.length <= 4000;
  }
  return false;
}

export function createSignalingServer({
  allowedOrigins = ['http://localhost:5173', 'http://127.0.0.1:5173'],
  roomTtlMs = ROOM_TTL_MS,
  maxConnectionsPerIp = 8,
  maxConnectionsPerMinute = 25,
  maxMessagesPerMinute = 240,
} = {}) {
  const origins = new Set(allowedOrigins.map(x => x.trim()).filter(Boolean));
  if (!origins.size) throw new Error('ALLOWED_ORIGINS cannot be empty');
  const rooms = new Map();
  const clients = new Map();
  const ipSockets = new Map();
  const attempts = new Map();
  const server = http.createServer((req, res) => {
    if (req.url === '/health') {
      res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      res.end(JSON.stringify({ status: 'ok' }));
    } else {
      res.writeHead(404, { 'content-type': 'text/plain' });
      res.end('Not found');
    }
  });
  const wss = new WebSocketServer({ noServer: true, maxPayload: 48 * 1024, perMessageDeflate: false });

  function reply(ws, msg) {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
  }
  function prune(room, code, notifyHost = true) {
    rooms.delete(code);
    for (const peer of [room.host, room.guest]) {
      if (peer && clients.has(peer)) clients.delete(peer);
    }
    if (notifyHost) reply(room.host, { type: 'room-expired' });
    if (room.guest) reply(room.guest, { type: 'room-expired' });
  }
  function leave(ws) {
    const meta = clients.get(ws);
    if (!meta) return;
    clients.delete(ws);
    const room = rooms.get(meta.code);
    if (!room) return;
    if (room.host === ws) {
      rooms.delete(meta.code);
      if (room.guest) {
        clients.delete(room.guest);
        reply(room.guest, { type: 'host-left' });
      }
    } else if (room.guest === ws) {
      room.guest = null;
      reply(room.host, { type: 'peer-left' });
    }
  }
  function rate(window, now, limit) {
    if (now - window.startedAt >= 60_000) {
      window.startedAt = now;
      window.count = 0;
    }
    window.count++;
    return window.count <= limit;
  }
  function refuseUpgrade(socket, status = 403) {
    socket.write(`HTTP/1.1 ${status} Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
    socket.destroy();
  }
  server.on('upgrade', (req, socket, head) => {
    // No wildcard origins; WebSocket clients can set Origin, so this is a CSWSH
    // defense, not a replacement for the unguessable room secret.
    const ip = req.socket.remoteAddress || 'unknown';
    const now = Date.now();
    const window = attempts.get(ip) || { count: 0, startedAt: now };
    attempts.set(ip, window);
    if (!rate(window, now, maxConnectionsPerMinute)) return refuseUpgrade(socket, 429);
    let pathname;
    try { pathname = new URL(req.url || '/', 'http://local').pathname; }
    catch { return refuseUpgrade(socket, 400); }
    if (pathname !== '/signal' || !origins.has(req.headers.origin)) return refuseUpgrade(socket, 403);
    if ((ipSockets.get(ip)?.size || 0) >= maxConnectionsPerIp) return refuseUpgrade(socket, 429);
    wss.handleUpgrade(req, socket, head, ws => {
      const group = ipSockets.get(ip) || new Set();
      group.add(ws);
      ipSockets.set(ip, group);
      wss.emit('connection', ws, req, ip);
    });
  });

  wss.on('connection', (ws, _req, ip) => {
    let socketWindow = { count: 0, startedAt: Date.now() };
    ws.alive = true;
    ws.on('pong', () => { ws.alive = true; });
    ws.on('message', raw => {
      if (!rate(socketWindow, Date.now(), maxMessagesPerMinute)) {
        reply(ws, { type: 'error', message: 'Too many messages' });
        ws.close(1008, 'rate limit');
        return;
      }
      let msg;
      try { msg = JSON.parse(raw.toString()); }
      catch { reply(ws, { type: 'error', message: 'Invalid JSON' }); return; }
      if (!msg || typeof msg !== 'object' || Array.isArray(msg)) return;
      if (msg.type === 'create') {
        if (clients.has(ws)) return reply(ws, { type: 'error', message: 'Leave your room first' });
        let code;
        do { code = makeCode(); } while (rooms.has(code));
        rooms.set(code, { host: ws, guest: null, createdAt: Date.now() });
        clients.set(ws, { code, role: 'host' });
        reply(ws, { type: 'room-created', room: code });
        return;
      }
      if (msg.type === 'join') {
        if (clients.has(ws)) return reply(ws, { type: 'error', message: 'Leave your room first' });
        const code = msg.room;
        if (!isValidCode(code)) return reply(ws, { type: 'error', message: 'Invalid pairing code' });
        const room = rooms.get(code);
        if (!room || room.guest || Date.now() - room.createdAt >= roomTtlMs) {
          return reply(ws, { type: 'error', message: 'Room unavailable or expired' });
        }
        room.guest = ws;
        clients.set(ws, { code, role: 'guest' });
        reply(ws, { type: 'joined', room: code });
        reply(room.host, { type: 'peer-ready', initiator: true });
        reply(room.guest, { type: 'peer-ready', initiator: false });
        return;
      }
      if (msg.type === 'signal') {
        const meta = clients.get(ws);
        if (!meta || !isValidSignal(msg.data)) return reply(ws, { type: 'error', message: 'Invalid signal' });
        const room = rooms.get(meta.code);
        const peer = meta.role === 'host' ? room?.guest : room?.host;
        if (!peer) return reply(ws, { type: 'error', message: 'Peer unavailable' });
        reply(peer, { type: 'signal', data: msg.data });
      }
    });
    const cleanup = () => {
      leave(ws);
      const group = ipSockets.get(ip);
      if (group) {
        group.delete(ws);
        if (!group.size) ipSockets.delete(ip);
      }
    };
    ws.once('close', cleanup);
    ws.on('error', () => {}); // close will perform cleanup
  });

  const heartbeat = setInterval(() => {
    const now = Date.now();
    for (const [code, room] of rooms) {
      if (!room.guest && now - room.createdAt >= roomTtlMs) prune(room, code);
    }
    for (const ws of wss.clients) {
      if (!ws.alive) { ws.terminate(); continue; }
      ws.alive = false;
      ws.ping();
    }
    for (const [ip, info] of attempts) {
      if (now - info.startedAt > 120_000) attempts.delete(ip);
    }
  }, HEARTBEAT_MS);
  heartbeat.unref();
  return {
    server,
    wss,
    async listen(port = 8787, host = '127.0.0.1') {
      return new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, host, () => {
          server.off('error', reject);
          resolve(server.address());
        });
      });
    },
    async close() {
      clearInterval(heartbeat);
      for (const ws of wss.clients) ws.terminate();
      return new Promise((resolve, reject) => {
        wss.close(err => {
          if (err) return reject(err);
          server.close(error => error ? reject(error) : resolve());
        });
      });
    }
  };
}
