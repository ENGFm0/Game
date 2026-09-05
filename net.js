/**
 * Meccha — network transport.
 *
 *  • Socket.io mode: when the page is served by server.js (window.io is present).
 *  • Serverless mode (static hosting, e.g. GitHub Pages): the player who creates the room becomes
 *    the host; their phone runs the shared game core (game-core.js) and every other phone connects
 *    to it directly over WebRTC data channels (PeerJS handles signalling; no backend needed).
 *
 * Both expose the same API: net.id, net.on(event, fn), net.emit(event, payload, ack), net.mode.
 */

const PEER_PREFIX = 'meccha-hs-';
const ACTIONS = ['player:role', 'player:name', 'room:settings', 'game:start', 'hider:ready', 'hider:unready', 'seeker:found', 'game:reset', 'room:addBot', 'room:removeBots'];

function emitter() {
  const listeners = new Map();
  return {
    on(ev, fn) { (listeners.get(ev) || listeners.set(ev, []).get(ev)).push(fn); },
    fire(ev, payload) { (listeners.get(ev) || []).forEach((fn) => fn(payload)); },
  };
}

/* ───────────────────────── Socket.io transport ───────────────────────── */
function socketNet() {
  const socket = window.io({ transports: ['websocket', 'polling'] });
  const net = {
    mode: 'socket',
    get id() { return socket.id; },
    on: (ev, fn) => socket.on(ev, fn),
    emit: (ev, payload, ack) => socket.emit(ev, payload, ack),
  };
  return Promise.resolve(net);
}

/* ───────────────────────── WebRTC (PeerJS) transport ───────────────────────── */
function peerConfig() {
  return Object.assign({ debug: 0, config: { iceServers: [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }] } }, window.MECCHA_PEER_CONFIG || {});
}

function peerNet() {
  const ev = emitter();
  let peer = null, role = null;          // role: 'host' | 'client'
  let room = null;                       // GameRoom (host only)
  const conns = new Map();               // host: playerId → DataConnection
  let hostConn = null;                   // client: connection to the host
  const pending = new Map();             // client: ack id → resolve
  let reqId = 0;
  const { GameRoom, makeCode } = window.MecchaCore;

  const fail = (message) => ev.fire('error:msg', { message });

  function destroyPeer() {
    if (room) { room.dispose(); room = null; }
    conns.forEach((c) => c.close()); conns.clear();
    if (hostConn) { hostConn.close(); hostConn = null; }
    if (peer) { peer.destroy(); peer = null; }
    role = null;
  }

  function newPeer(id) {
    return new Promise((resolve, reject) => {
      const p = new window.Peer(id, peerConfig());
      p.once('open', () => resolve(p));
      p.once('error', (e) => reject(e));
    });
  }

  /* ── host ── */
  async function createRoom({ name, role: myRole }) {
    destroyPeer();
    let code, attempts = 0;
    while (!peer) {
      code = makeCode();
      try { peer = await newPeer(PEER_PREFIX + code); }
      catch (e) {
        if (e.type === 'unavailable-id' && attempts++ < 5) continue;
        return fail(e.type === 'browser-incompatible' ? 'This browser cannot do peer-to-peer. Try Chrome or Safari.' : 'Could not reach the signalling service. Check your internet connection.');
      }
    }
    role = 'host';
    room = new GameRoom({
      code,
      hostId: peer.id,
      emit: (target, event, payload) => {
        const msg = { t: 'ev', ev: event, payload };
        if (target === '*') { ev.fire(event, payload); conns.forEach((c) => c.open && c.send(msg)); }
        else if (target === peer.id) ev.fire(event, payload);
        else { const c = conns.get(target); if (c && c.open) c.send(msg); }
      },
    });
    peer.on('connection', (conn) => {
      conn.on('data', (msg) => {
        if (!msg || typeof msg !== 'object' || !room) return;
        if (msg.t === 'join') { conns.set(conn.peer, conn); room.join(conn.peer, { name: msg.name, role: msg.role }); }
        else if (msg.t === 'req' && ACTIONS.includes(msg.ev)) { const result = room.handle(conn.peer, msg.ev, msg.payload); if (msg.id) conn.send({ t: 'ack', id: msg.id, result }); }
        else if (msg.t === 'leave') { conn.close(); }
      });
      const gone = () => { if (conns.get(conn.peer) === conn) { conns.delete(conn.peer); room && room.leave(conn.peer); } };
      conn.on('close', gone); conn.on('error', gone);
    });
    peer.on('error', (e) => { if (e.type !== 'peer-unavailable') fail('Connection problem: ' + e.type); });
    peer.on('disconnected', () => peer && peer.reconnect());
    room.join(peer.id, { name, role: myRole });
  }

  /* ── client ── */
  async function joinRoom({ code, name, role: myRole }) {
    destroyPeer();
    code = String(code || '').trim().toUpperCase();
    try { peer = await newPeer(undefined); }
    catch (e) { return fail('Could not reach the signalling service. Check your internet connection.'); }
    role = 'client';
    peer.on('error', (e) => {
      if (e.type === 'peer-unavailable') fail('Room not found. Check the code (the host must keep the page open).');
      else fail('Connection problem: ' + e.type);
    });
    peer.on('disconnected', () => peer && peer.reconnect());
    const conn = peer.connect(PEER_PREFIX + code, { reliable: true, serialization: 'json' });
    hostConn = conn;
    let joined = false;
    conn.on('open', () => conn.send({ t: 'join', name, role: myRole }));
    conn.on('data', (msg) => {
      if (!msg || typeof msg !== 'object') return;
      if (msg.t === 'ev') { if (msg.ev === 'room:joined') joined = true; ev.fire(msg.ev, msg.payload); }
      else if (msg.t === 'ack' && pending.has(msg.id)) { pending.get(msg.id)(msg.result); pending.delete(msg.id); }
    });
    conn.on('close', () => { if (hostConn === conn && joined) { hostConn = null; ev.fire('room:closed', { message: 'The host left — the room is closed.' }); } });
    setTimeout(() => { if (hostConn === conn && !conn.open) fail('Could not connect to the host. Make sure both phones are online and the code is right.'); }, 15000);
  }

  function leave() {
    if (role === 'client' && hostConn && hostConn.open) hostConn.send({ t: 'leave' });
    destroyPeer();
  }

  const net = {
    mode: 'peer',
    get id() { return peer ? peer.id : null; },
    on: ev.on,
    emit(event, payload, ack) {
      if (event === 'room:create') return createRoom(payload || {});
      if (event === 'room:join') return joinRoom(payload || {});
      if (event === 'room:leave') return leave();
      if (!ACTIONS.includes(event)) return;
      if (role === 'host' && room) { const r = room.handle(peer.id, event, payload); if (ack) ack(r); }
      else if (role === 'client' && hostConn && hostConn.open) {
        const id = ++reqId;
        if (ack) pending.set(id, ack);
        hostConn.send({ t: 'req', id, ev: event, payload });
      } else if (ack) ack({ ok: false });
    },
  };
  return Promise.resolve(net);
}

/** Picks the transport: Socket.io when the server is present, otherwise WebRTC. */
export function createNet() {
  if (window.io && !window.__noSocket) return socketNet();
  if (!window.Peer || !window.MecchaCore) return Promise.reject(new Error('Peer-to-peer library failed to load. Check your connection and reload.'));
  return peerNet();
}
