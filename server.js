'use strict';

/**
 * Meccha — WebAR Multiplayer Hide & Seek
 * Backend: Express static host + Socket.io transport around the shared game core.
 *
 *   npm install
 *   npm start                  → http://localhost:3000  (Glitch/Replit/Render terminate HTTPS for you)
 *   npm run certs && npm start → https://localhost:3000 (self-signed, for phones on your LAN)
 *
 * The same client also runs without this server (static hosting such as GitHub Pages):
 * the host's phone then runs public/game-core.js and the others connect over WebRTC.
 */

const path = require('path');
const fs = require('fs');
const http = require('http');
const https = require('https');
const express = require('express');
const { Server } = require('socket.io');
const { GameRoom, makeCode } = require('./public/game-core');

const PORT = process.env.PORT || 3000;

/* ───────────────────────── HTTP(S) server ───────────────────────── */
const app = express();
app.disable('x-powered-by');
app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] }));
app.get('/api/health', (_req, res) => res.json({ ok: true, rooms: rooms.size, uptime: process.uptime() }));

function createServer() {
  const keyPath = path.join(__dirname, 'certs', 'key.pem');
  const certPath = path.join(__dirname, 'certs', 'cert.pem');
  if (fs.existsSync(keyPath) && fs.existsSync(certPath)) {
    return { server: https.createServer({ key: fs.readFileSync(keyPath), cert: fs.readFileSync(certPath) }, app), secure: true };
  }
  return { server: http.createServer(app), secure: false };
}
const { server, secure } = createServer();
const io = new Server(server, { cors: { origin: '*' }, maxHttpBufferSize: 1e6, pingTimeout: 30000 });

/* ───────────────────────── Rooms ───────────────────────── */
/** @type {Map<string, GameRoom>} */
const rooms = new Map();

function createRoom(hostId) {
  const code = makeCode((c) => rooms.has(c));
  const room = new GameRoom({
    code,
    hostId,
    // Socket.io puts every socket in a room named after its id, so io.to(playerId) targets one player.
    emit: (target, event, payload) => io.to(target === '*' ? code : target).emit(event, payload),
  });
  rooms.set(code, room);
  return room;
}

function dropIfEmpty(room) { if (room.empty) { room.dispose(); rooms.delete(room.code); } }

/* ───────────────────────── Socket handlers ───────────────────────── */
io.on('connection', (socket) => {
  let room = null;

  function leaveRoom() {
    if (!room) return;
    const r = room; room = null;
    r.leave(socket.id);
    socket.leave(r.code);
    dropIfEmpty(r);
  }

  function joinRoom(r, name, role) {
    socket.join(r.code);
    const res = r.join(socket.id, { name, role });
    if (res.ok) room = r; else { socket.leave(r.code); dropIfEmpty(r); }
  }

  socket.on('room:create', ({ name, role } = {}) => { leaveRoom(); joinRoom(createRoom(socket.id), name, role); });

  socket.on('room:join', ({ code, name, role } = {}) => {
    const r = rooms.get(String(code || '').trim().toUpperCase());
    if (!r) return socket.emit('error:msg', { message: 'Room not found. Check the code.' });
    leaveRoom();
    joinRoom(r, name, role);
  });

  socket.on('room:leave', () => leaveRoom());
  socket.on('disconnect', () => leaveRoom());

  // Every other event is a game action handled by the shared core (ack-aware).
  for (const event of ['player:role', 'player:name', 'room:settings', 'game:start', 'hider:ready', 'hider:unready', 'seeker:found', 'game:reset', 'room:addBot', 'room:removeBots']) {
    socket.on(event, (payload, ack) => {
      const result = room ? room.handle(socket.id, event, payload) : { ok: false };
      if (typeof ack === 'function') ack(result);
    });
  }
});

/* Drop stale empty rooms (defensive; empty rooms are normally deleted immediately). */
setInterval(() => {
  const cutoff = Date.now() - 6 * 3600 * 1000;
  for (const r of rooms.values()) if (r.createdAt < cutoff && r.empty) { r.dispose(); rooms.delete(r.code); }
}, 10 * 60 * 1000).unref();

if (require.main === module) {
  server.listen(PORT, () => {
    console.log(`Meccha Hide & Seek running on ${secure ? 'https' : 'http'}://localhost:${PORT}`);
    if (!secure) console.log('Tip: phones need HTTPS for the camera. Run `npm run certs` for a local certificate, or host on Glitch/Replit/Render.');
  });
}

module.exports = { app, server, io, rooms };
