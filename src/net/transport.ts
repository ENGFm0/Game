/**
 * Transport — one API, two backends:
 *  • Socket.io when the page is served by server.js (or the Vite dev proxy).
 *  • Serverless (static hosting such as GitHub Pages): the player who creates the room becomes the
 *    host, their phone runs shared/game-core.js, and the others connect over WebRTC (PeerJS signalling).
 * Countdown sync: `syncClock()` measures the offset to the host clock so every phone starts
 * recording at the same absolute instant.
 */
import { io, Socket } from 'socket.io-client';
import Peer, { DataConnection } from 'peerjs';
import { GameRoom, makeCode } from '../../shared/game-core.js';

export type Handler = (payload: any) => void;
export interface Net {
  mode: 'socket' | 'peer';
  readonly id: string | null;
  on(event: string, fn: Handler): void;
  emit(event: string, payload?: any, ack?: (res: any) => void): void;
  request(event: string, payload?: any): Promise<any>;
  syncClock(): Promise<number>;   // resolves the host-clock offset (hostNow - Date.now())
}

const ACTIONS = ['time:ping', 'player:name', 'player:ready', 'room:settings', 'round:start', 'round:submit', 'game:end', 'game:reset', 'room:addSound', 'room:removeSound', 'room:builtIn'];
const PEER_PREFIX = 'mimic-party-';

function emitter() {
  const listeners = new Map<string, Handler[]>();
  return {
    on(ev: string, fn: Handler) { (listeners.get(ev) || listeners.set(ev, []).get(ev)!).push(fn); },
    fire(ev: string, payload: any) { (listeners.get(ev) || []).forEach((fn) => fn(payload)); },
  };
}

async function measureOffset(ping: () => Promise<{ serverNow: number } | null>): Promise<number> {
  const samples: number[] = [];
  for (let i = 0; i < 5; i++) {
    const t0 = Date.now();
    const r = await ping().catch(() => null);
    const t1 = Date.now();
    if (r && r.serverNow) samples.push(r.serverNow - (t0 + t1) / 2);
  }
  if (!samples.length) return 0;
  samples.sort((a, b) => a - b);
  return samples[Math.floor(samples.length / 2)];
}

/* ───────── Socket.io ───────── */
function socketNet(): Net {
  const socket: Socket = io({ transports: ['websocket', 'polling'] });
  const request = (event: string, payload?: any) => new Promise<any>((res) => socket.emit(event, payload || {}, res));
  return {
    mode: 'socket',
    get id() { return socket.id || null; },
    on: (ev, fn) => { socket.on(ev, fn); },
    emit: (ev, payload, ack) => { socket.emit(ev, payload || {}, ack); },
    request,
    syncClock: () => measureOffset(() => request('time:ping', { t: Date.now() })),
  };
}

/* ───────── WebRTC (PeerJS) ───────── */
function peerNet(): Net {
  const ev = emitter();
  let peer: Peer | null = null, role: 'host' | 'client' | null = null;
  let room: any = null;
  const conns = new Map<string, DataConnection>();
  let hostConn: DataConnection | null = null;
  const pending = new Map<number, (r: any) => void>();
  let reqId = 0;
  const fail = (message: string) => ev.fire('error:msg', { message });
  const cfg = () => Object.assign({ debug: 0, config: { iceServers: [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }] } }, (window as any).MIMIC_PEER_CONFIG || {});

  function destroy() {
    if (room) { room.dispose(); room = null; }
    conns.forEach((c) => c.close()); conns.clear();
    if (hostConn) { hostConn.close(); hostConn = null; }
    if (peer) { peer.destroy(); peer = null; }
    role = null;
  }
  const newPeer = (id?: string) => new Promise<Peer>((resolve, reject) => {
    const p = new Peer(id as any, cfg());
    p.once('open', () => resolve(p));
    p.once('error', (e) => reject(e));
  });

  async function createRoom(payload: any) {
    destroy();
    let code = '', attempts = 0;
    while (!peer) {
      code = makeCode();
      try { peer = await newPeer(PEER_PREFIX + code); }
      catch (e: any) {
        if (e?.type === 'unavailable-id' && attempts++ < 5) continue;
        return fail(e?.type === 'browser-incompatible' ? 'This browser cannot do peer-to-peer. Try Safari or Chrome.' : 'Could not reach the signalling service — check your internet connection.');
      }
    }
    role = 'host';
    const me = peer.id;
    room = new GameRoom({
      code, hostId: me,
      emit: (target: string, event: string, data: any) => {
        const msg = { t: 'ev', ev: event, payload: data };
        if (target === '*') { ev.fire(event, data); conns.forEach((c) => c.open && c.send(msg)); }
        else if (target === me) ev.fire(event, data);
        else { const c = conns.get(target); if (c && c.open) c.send(msg); }
      },
    });
    peer.on('connection', (conn) => {
      conn.on('data', (raw: any) => {
        const msg = raw && typeof raw === 'object' ? raw : null;
        if (!msg || !room) return;
        if (msg.t === 'join') { conns.set(conn.peer, conn); room.join(conn.peer, msg.payload || {}); }
        else if (msg.t === 'req' && ACTIONS.includes(msg.ev)) { const result = room.handle(conn.peer, msg.ev, msg.payload); if (msg.id) conn.send({ t: 'ack', id: msg.id, result }); }
        else if (msg.t === 'leave') conn.close();
      });
      const gone = () => { if (conns.get(conn.peer) === conn) { conns.delete(conn.peer); room && room.leave(conn.peer); } };
      conn.on('close', gone); conn.on('error', gone);
    });
    peer.on('error', (e: any) => { if (e?.type !== 'peer-unavailable') fail('Connection problem: ' + e?.type); });
    peer.on('disconnected', () => peer && peer.reconnect());
    room.join(me, payload);
  }

  async function joinRoom(payload: any) {
    destroy();
    const code = String(payload.code || '').trim().toUpperCase();
    try { peer = await newPeer(undefined); }
    catch { return fail('Could not reach the signalling service — check your internet connection.'); }
    role = 'client';
    peer.on('error', (e: any) => {
      if (e?.type === 'peer-unavailable') fail('Room not found — check the code (the host must keep the page open).');
      else fail('Connection problem: ' + e?.type);
    });
    peer.on('disconnected', () => peer && peer.reconnect());
    // binary serialisation: PeerJS chunks large messages (round results carry every recording)
    const conn = peer.connect(PEER_PREFIX + code, { reliable: true, serialization: 'binary' });
    hostConn = conn;
    let joined = false;
    conn.on('open', () => conn.send({ t: 'join', payload }));
    conn.on('data', (raw: any) => {
      const msg = raw && typeof raw === 'object' ? raw : null;
      if (!msg) return;
      if (msg.t === 'ev') { if (msg.ev === 'room:joined') joined = true; ev.fire(msg.ev, msg.payload); }
      else if (msg.t === 'ack' && pending.has(msg.id)) { pending.get(msg.id)!(msg.result); pending.delete(msg.id); }
    });
    conn.on('close', () => { if (hostConn === conn && joined) { hostConn = null; ev.fire('room:closed', { message: 'The host left — the room is closed.' }); } });
    setTimeout(() => { if (hostConn === conn && !conn.open) fail('Could not connect to the host. Both phones need internet and the right code.'); }, 15000);
  }

  function emit(event: string, payload?: any, ack?: (r: any) => void) {
    if (event === 'room:create') { createRoom(payload || {}); return; }
    if (event === 'room:join') { joinRoom(payload || {}); return; }
    if (event === 'room:leave') { if (role === 'client' && hostConn?.open) hostConn.send({ t: 'leave' }); destroy(); return; }
    if (!ACTIONS.includes(event)) return;
    if (role === 'host' && room && peer) { const r = room.handle(peer.id, event, payload || {}); ack && ack(r); }
    else if (role === 'client' && hostConn?.open) { const id = ++reqId; if (ack) pending.set(id, ack); hostConn.send({ t: 'req', id, ev: event, payload: payload || {} }); }
    else ack && ack({ ok: false });
  }
  const request = (event: string, payload?: any) => new Promise<any>((res) => emit(event, payload, res));

  return {
    mode: 'peer',
    get id() { return peer ? peer.id : null; },
    on: ev.on,
    emit,
    request,
    syncClock: () => (role === 'host' ? Promise.resolve(0) : measureOffset(() => request('time:ping', { t: Date.now() }))),
  };
}

/** Picks the transport: Socket.io if a game server answers, otherwise serverless WebRTC. */
export async function createNet(): Promise<Net> {
  try {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 2500);
    const r = await fetch('./api/health', { signal: ctl.signal, cache: 'no-store' });
    clearTimeout(timer);
    if (r.ok && (await r.json()).ok) return socketNet();
  } catch { /* no server → serverless */ }
  return peerNet();
}
