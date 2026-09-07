/**
 * Mimic Party — server.
 * Express serves the built client (dist/) and Socket.io carries the room protocol; all game
 * rules live in shared/game-core.js so the exact same logic also runs serverless in the browser.
 *
 *   npm install && npm run build
 *   npm start                  → http://localhost:3000  (Glitch / Replit / Render add HTTPS)
 *   npm run certs && npm start → https://localhost:3000 (self-signed, phones on your Wi-Fi)
 */
import path from 'node:path';
import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { Server } from 'socket.io';
import { GameRoom, makeCode } from './shared/game-core.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;
const DIST = path.join(__dirname, 'dist');

const app = express();
app.disable('x-powered-by');
app.get('/api/health', (_req, res) => res.json({ ok: true, rooms: rooms.size, uptime: process.uptime() }));
if (fs.existsSync(DIST)) {
  app.use(express.static(DIST));
  app.get('*', (_req, res) => res.sendFile(path.join(DIST, 'index.html')));
} else {
  app.get('*', (_req, res) => res.status(503).send('Client not built yet. Run `npm run build` (or `npm run dev` for development).'));
}

function createServer() {
  const key = path.join(__dirname, 'certs', 'key.pem'), cert = path.join(__dirname, 'certs', 'cert.pem');
  if (fs.existsSync(key) && fs.existsSync(cert)) return { server: https.createServer({ key: fs.readFileSync(key), cert: fs.readFileSync(cert) }, app), secure: true };
  return { server: http.createServer(app), secure: false };
}
const { server, secure } = createServer();
const io = new Server(server, { cors: { origin: '*' }, maxHttpBufferSize: 2e6, pingTimeout: 30000 });

/** @type {Map<string, GameRoom>} */
const rooms = new Map();
const ACTIONS = ['time:ping', 'player:name', 'player:ready', 'room:settings', 'round:start', 'round:submit', 'game:end', 'game:reset'];

function createRoom(hostId) {
  const code = makeCode((c) => rooms.has(c));
  const room = new GameRoom({ code, hostId, emit: (target, event, payload) => io.to(target === '*' ? code : target).emit(event, payload) });
  rooms.set(code, room);
  return room;
}
const dropIfEmpty = (room) => { if (room.empty) { room.dispose(); rooms.delete(room.code); } };

io.on('connection', (socket) => {
  let room = null;

  const leaveRoom = () => { if (!room) return; const r = room; room = null; r.leave(socket.id); socket.leave(r.code); dropIfEmpty(r); };
  const joinRoom = (r, payload) => { socket.join(r.code); const res = r.join(socket.id, payload); if (res.ok) room = r; else { socket.leave(r.code); dropIfEmpty(r); } };

  socket.on('room:create', (payload = {}) => { leaveRoom(); joinRoom(createRoom(socket.id), payload); });
  socket.on('room:join', (payload = {}) => {
    const r = rooms.get(String(payload.code || '').trim().toUpperCase());
    if (!r) return socket.emit('error:msg', { message: 'Room not found — check the code.' });
    leaveRoom(); joinRoom(r, payload);
  });
  socket.on('room:leave', leaveRoom);
  socket.on('disconnect', leaveRoom);

  for (const event of ACTIONS) {
    socket.on(event, (payload, ack) => {
      const result = room ? room.handle(socket.id, event, payload) : (event === 'time:ping' ? { ok: true, serverNow: Date.now(), echo: payload && payload.t } : { ok: false });
      if (typeof ack === 'function') ack(result);
    });
  }
});

setInterval(() => { for (const r of rooms.values()) if (r.empty && r.createdAt < Date.now() - 6 * 3600e3) { r.dispose(); rooms.delete(r.code); } }, 600e3).unref();

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  server.listen(PORT, () => {
    console.log(`Mimic Party on ${secure ? 'https' : 'http'}://localhost:${PORT}`);
    if (!secure) console.log('Phones need HTTPS for the microphone: `npm run certs`, or host on Glitch/Replit/Render.');
  });
}

export { app, server, io, rooms };
