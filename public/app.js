/**
 * Meccha — WebAR Multiplayer Hide & Seek (client)
 *
 * Modes:
 *  • WebXR "immersive-ar" (Android Chrome): true 6-DoF tracking, hit-test placement,
 *    raw camera access for the eyedropper (optional feature, falls back to the color wheel).
 *  • Fallback (iOS Safari / other): live camera <video> + gyroscope orientation (3-DoF).
 *    Avatars are placed relative to the calibrated origin at a fixed distance.
 *
 * Shared coordinates: every player calibrates from the same physical spot facing the same wall
 * ("Set origin"). All positions are exchanged in that room frame.
 */
import * as THREE from 'https://unpkg.com/three@0.160.0/build/three.module.js';
import { createNet } from './net.js';

/* ═══════════════════════════ helpers ═══════════════════════════ */
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const fmtTime = (ms) => { const s = Math.max(0, Math.ceil(ms / 1000)); return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`; };

let toastTimer = 0;
function toast(msg, ms = 2600) {
  const el = $('#toast');
  el.textContent = msg; el.classList.add('is-on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('is-on'), ms);
}
function showScreen(name) {
  $$('.screen').forEach((s) => { s.hidden = s.dataset.screen !== name; });
}
let audioCtx = null;
/** Tiny synth for shot / hit sounds (no assets needed). */
function sfx(kind) {
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    const t = audioCtx.currentTime, o = audioCtx.createOscillator(), g = audioCtx.createGain();
    o.connect(g); g.connect(audioCtx.destination);
    if (kind === 'shot') { o.type = 'square'; o.frequency.setValueAtTime(880, t); o.frequency.exponentialRampToValueAtTime(140, t + .12); g.gain.setValueAtTime(.25, t); g.gain.exponentialRampToValueAtTime(.001, t + .15); o.start(t); o.stop(t + .16); }
    else if (kind === 'hit') { o.type = 'sawtooth'; o.frequency.setValueAtTime(220, t); o.frequency.exponentialRampToValueAtTime(60, t + .35); g.gain.setValueAtTime(.35, t); g.gain.exponentialRampToValueAtTime(.001, t + .4); o.start(t); o.stop(t + .42); }
    else { o.type = 'triangle'; o.frequency.setValueAtTime(300, t); g.gain.setValueAtTime(.12, t); g.gain.exponentialRampToValueAtTime(.001, t + .1); o.start(t); o.stop(t + .11); }
  } catch (_) { /* audio blocked */ }
}
function vibrate(pattern) { try { navigator.vibrate && navigator.vibrate(pattern); } catch (_) { /* unsupported */ } }

/* ═══════════════════════════ state ═══════════════════════════ */
const state = {
  id: null,
  name: localStorage.getItem('meccha.name') || '',
  role: localStorage.getItem('meccha.role') || 'hider',
  room: null,
  clockOffset: 0,          // serverNow - Date.now()
  ar: null,                // active ARSession
  arRole: null,            // 'hider' | 'seeker' | 'watch'
};
// Socket.io when served by server.js, otherwise serverless WebRTC (host phone runs the game core).
const net = await createNet().catch((e) => { toast(e.message, 6000); throw e; });

const me = () => state.room && state.room.players.find((p) => p.id === state.id);
const isHost = () => state.room && state.room.hostId === state.id;
const hiders = () => (state.room ? state.room.players.filter((p) => p.role === 'hider') : []);

/* ═══════════════════════════ socket events ═══════════════════════════ */
net.on('connect', () => { state.id = net.id; });
net.on('disconnect', () => toast('Connection lost — reconnecting…'));
net.on('room:closed', ({ message }) => { toast(message, 5000); if (state.ar) state.ar.stop(); state.room = null; history.replaceState(null, '', location.pathname); showScreen('lobby'); });
net.on('error:msg', ({ message }) => toast(message));

net.on('room:joined', ({ code, id }) => {
  state.id = id;
  history.replaceState(null, '', `?room=${code}`);
  showScreen('room');
});

net.on('room:state', (room) => {
  state.room = room;
  state.clockOffset = room.serverNow - Date.now();
  renderRoom();
  if (state.ar) state.ar.onRoomState(room);
});

net.on('game:phase', ({ phase }) => {
  if (phase === 'hide') { toast('Hide phase started!'); vibrate(80); }
  if (phase === 'seek') { toast('Seek phase — seekers, go!'); vibrate([80, 60, 80]); }
  if (phase === 'lobby' && state.ar) state.ar.stop();
});

net.on('player:found', ({ targetId, targetName, seekerName }) => {
  vibrate([120, 60, 120]);
  if (targetId === state.id) toast(`💥 ${seekerName} shot you!`, 4000);
  else toast(`💥 ${seekerName} hit ${targetName}!`);
  if (state.ar) state.ar.markFound(targetId, seekerName);
});

net.on('game:results', ({ winner, foundCount, hiderCount }) => {
  vibrate([200, 100, 200]);
  toast(winner === 'seekers' ? `Seekers win — all ${hiderCount} found!` : winner === 'hiders' ? `Hiders win — ${hiderCount - foundCount} never found!` : 'Round over.');
  if (state.ar) state.ar.stop();
});

/* ═══════════════════════════ lobby UI ═══════════════════════════ */
$('#nameInput').value = state.name;
function setRoleUI(role) {
  state.role = role;
  localStorage.setItem('meccha.role', role);
  $$('#roleSeg button, #roomRoleSeg button').forEach((b) => b.classList.toggle('is-active', b.dataset.role === role));
}
setRoleUI(state.role);
$('#roleSeg').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) setRoleUI(b.dataset.role); });
$('#roomRoleSeg').addEventListener('click', (e) => {
  const b = e.target.closest('button'); if (!b) return;
  setRoleUI(b.dataset.role);
  net.emit('player:role', { role: b.dataset.role });
});

function readName() {
  const n = $('#nameInput').value.trim().slice(0, 16);
  if (!n) { toast('Enter your name first'); $('#nameInput').focus(); return null; }
  state.name = n; localStorage.setItem('meccha.name', n);
  return n;
}
$('#createBtn').addEventListener('click', () => { const name = readName(); if (name) net.emit('room:create', { name, role: state.role }); });
$('#joinBtn').addEventListener('click', () => {
  const name = readName(); if (!name) return;
  const code = $('#codeInput').value.trim().toUpperCase();
  if (code.length !== 4) return toast('Enter the 4-character room code');
  net.emit('room:join', { code, name, role: state.role });
});
$('#codeInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#joinBtn').click(); });

$('#leaveBtn').addEventListener('click', () => { net.emit('room:leave'); state.room = null; history.replaceState(null, '', location.pathname); showScreen('lobby'); });
$('#shareBtn').addEventListener('click', async () => {
  const url = `${location.origin}${location.pathname}?room=${state.room.code}`;
  try {
    if (navigator.share) await navigator.share({ title: 'Meccha Hide & Seek', text: `Join my room ${state.room.code}`, url });
    else { await navigator.clipboard.writeText(url); toast('Link copied'); }
  } catch (_) { /* user cancelled */ }
});
$('#startBtn').addEventListener('click', () => {
  net.emit('room:settings', { hideSeconds: $('#hideSeconds').value, seekSeconds: $('#seekSeconds').value });
  net.emit('game:start');
});
$('#playAgainBtn').addEventListener('click', () => net.emit('game:start'));
$('#addBotHiderBtn').addEventListener('click', () => net.emit('room:addBot', { role: 'hider' }));
$('#addBotSeekerBtn').addEventListener('click', () => net.emit('room:addBot', { role: 'seeker' }));
$('#removeBotsBtn').addEventListener('click', () => net.emit('room:removeBots'));
net.on('bot:hint', ({ botName, text }) => toast(`🤖 ${botName} ${text}`, 3000));
$('#backToLobbyBtn').addEventListener('click', () => net.emit('game:reset'));
$('#enterHideBtn').addEventListener('click', () => enterAR('hider'));
$('#enterSeekBtn').addEventListener('click', () => enterAR('seeker'));
$('#watchBtn').addEventListener('click', () => enterAR('watch'));

/* Support hint + auto-fill code from ?room= */
(async () => {
  const xr = !!(navigator.xr && await navigator.xr.isSessionSupported('immersive-ar').catch(() => false));
  $('#supportHint').textContent = (xr
    ? 'WebXR AR detected — full 6-DoF tracking available.'
    : (/android/i.test(navigator.userAgent)
        ? 'No WebXR here: install "Google Play Services for AR" from the Play Store and use Chrome for full room tracking. Until then: camera + gyroscope mode (turning only).'
        : 'This browser has no WebXR AR (iPhone Safari): camera + gyroscope mode — the avatar stays put when you turn, but the phone cannot sense you walking.'))
    + (net.mode === 'peer' ? ' Serverless mode: the room lives on the host\'s phone, so the host must keep the page open.' : '');
  const code = new URLSearchParams(location.search).get('room');
  if (code) $('#codeInput').value = code.toUpperCase();
})();

/* ═══════════════════════════ room rendering ═══════════════════════════ */
function renderRoom() {
  const r = state.room; if (!r) return;
  const self = me(); if (!self) return;
  $('#roomCode').textContent = r.code;
  const pill = $('#phasePill');
  pill.dataset.phase = r.phase;
  pill.textContent = { lobby: 'Lobby', hide: '🦎 Hide phase', seek: '🔍 Seek phase', results: '🏁 Results' }[r.phase];
  $('#roomTimer').hidden = !r.phaseEndsAt;

  // players
  const list = $('#playersList');
  list.innerHTML = '';
  for (const p of r.players) {
    const li = document.createElement('li');
    li.className = 'player' + (p.id === state.id ? ' is-me' : '');
    const status = [];
    if (p.id === r.hostId) status.push('<span class="badge badge--host">host</span>');
    if (r.phase === 'hide' && p.role === 'hider') status.push(p.ready ? '<span class="badge badge--ok">ready</span>' : '<span class="badge">hiding…</span>');
    if ((r.phase === 'seek' || r.phase === 'results') && p.role === 'hider') status.push(p.found ? '<span class="badge badge--found">found</span>' : '<span class="badge badge--ok">hidden</span>');
    li.innerHTML = `<div class="player__avatar">${p.bot ? '🤖' : p.role === 'hider' ? '🦎' : '🔍'}</div>
      <div class="player__name">${escapeHtml(p.name)}<small>${p.role}</small></div>
      <div>${status.join(' ')}</div>`;
    list.appendChild(li);
  }

  // phase panels
  $('#lobbyControls').hidden = r.phase !== 'lobby';
  $('#hideControls').hidden = r.phase !== 'hide';
  $('#seekControls').hidden = r.phase !== 'seek';
  $('#resultsControls').hidden = r.phase !== 'results';
  $('#hostControls').hidden = !isHost();
  $('#waitHostHint').hidden = isHost();
  $('#hostResultControls').hidden = !isHost();
  if (isHost() && document.activeElement !== $('#hideSeconds') && document.activeElement !== $('#seekSeconds')) {
    $('#hideSeconds').value = r.settings.hideSeconds; $('#seekSeconds').value = r.settings.seekSeconds;
  }
  $$('#roomRoleSeg button').forEach((b) => b.classList.toggle('is-active', b.dataset.role === self.role));

  const hs = hiders();
  const readyCount = hs.filter((p) => p.ready).length;
  $('#hiderNotice').hidden = self.role !== 'hider';
  $('#seekerWaitNotice').hidden = self.role !== 'seeker';
  $('#seekerWaitNotice').innerHTML = `<b>Seekers, close your eyes!</b> Hiders are placing themselves (${readyCount}/${hs.length} ready). Seeking starts when everyone is ready or the timer ends.`;
  $('#seekerNotice').hidden = self.role !== 'seeker';
  $('#hiderSeekNotice').hidden = self.role !== 'hider';

  if (r.phase === 'results') {
    const foundCount = hs.filter((p) => p.found && p.foundBy).length;
    const winner = hs.length === 0 ? 'Nobody played' : foundCount === hs.length ? '🔍 Seekers win!' : '🦎 Hiders win!';
    const rows = hs.map((p) => {
      const by = p.foundBy ? r.players.find((x) => x.id === p.foundBy) : null;
      const label = p.found ? (by ? `found by ${escapeHtml(by.name)}` : 'did not hide') : 'never found';
      return `<li class="player"><div class="player__name">${escapeHtml(p.name)}</div><span class="badge ${p.found ? 'badge--found' : 'badge--ok'}">${label}</span></li>`;
    }).join('');
    $('#resultsBox').innerHTML = `<h2>${winner}</h2><p class="hint">${foundCount} of ${hs.length} hiders found.</p><ul class="players">${rows}</ul>`;
  }
}
function escapeHtml(s) { return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

/* Timers (room screen + AR HUD) */
setInterval(() => {
  const r = state.room; if (!r || !r.phaseEndsAt) return;
  const left = r.phaseEndsAt - (Date.now() + state.clockOffset);
  $('#roomTimer').textContent = fmtTime(left);
  $('#hudTimer').textContent = fmtTime(left);
}, 250);

/* ═══════════════════════════ avatar ═══════════════════════════ */
const texLoader = new THREE.TextureLoader();

/**
 * Jointed mannequin (feet at y=0, ~1.7 m tall). Every limb pivots at its joint so poses can be applied.
 * The material is unlit on purpose: a camouflaged avatar must show *exactly* the sampled colour,
 * not a shaded version of it.
 */
function buildAvatar(playerId) {
  const material = new THREE.MeshBasicMaterial({ color: 0x8a8a8a });
  const mesh = (geo, y) => { const m = new THREE.Mesh(geo, material); m.position.y = y; return m; };
  const joint = (parent, x, y, z) => { const j = new THREE.Group(); j.position.set(x, y, z); parent.add(j); return j; };

  const g = new THREE.Group();
  const hips = joint(g, 0, 0.85, 0);
  hips.add(mesh(new THREE.CapsuleGeometry(0.17, 0.42, 6, 16), 0.27));          // torso  (centre 1.12)
  const head = joint(hips, 0, 0.62, 0);
  head.add(mesh(new THREE.SphereGeometry(0.12, 24, 18), 0.11));                 // head   (centre 1.58)
  const arm = (side) => {
    const upper = joint(hips, side * 0.25, 0.5, 0);                             // shoulder (1.35)
    upper.add(mesh(new THREE.CapsuleGeometry(0.055, 0.22, 4, 12), -0.14));
    const fore = joint(upper, 0, -0.28, 0);                                     // elbow
    fore.add(mesh(new THREE.CapsuleGeometry(0.05, 0.22, 4, 12), -0.14));
    return { upper, fore };
  };
  const leg = (side) => {
    const thigh = joint(hips, side * 0.1, 0, 0);                                // hip
    thigh.add(mesh(new THREE.CapsuleGeometry(0.08, 0.3, 4, 12), -0.2));
    const shin = joint(thigh, 0, -0.42, 0);                                     // knee
    shin.add(mesh(new THREE.CapsuleGeometry(0.07, 0.3, 4, 12), -0.2));
    return { thigh, shin };
  };
  const l = { arm: arm(-1), leg: leg(-1) }, r = { arm: arm(1), leg: leg(1) };
  // Invisible, generous hit volume so seekers can tap it easily.
  const hit = new THREE.Mesh(new THREE.CapsuleGeometry(0.45, 0.9, 4, 10), new THREE.MeshBasicMaterial({ visible: false }));
  hit.position.y = 0.9; hit.name = 'hit'; g.add(hit);
  g.userData = { playerId, material, hit, found: false, pose: 'stand',
    joints: { hips, head, lArm: l.arm.upper, lFore: l.arm.fore, rArm: r.arm.upper, rFore: r.arm.fore, lThigh: l.leg.thigh, lShin: l.leg.shin, rThigh: r.leg.thigh, rShin: r.leg.shin } };
  applyPose(g, 'stand');
  return g;
}

/** Joint rotations per pose (radians, [x, y, z]); hipsY lifts/lowers the whole body; hipsRot tips it over. */
const POSES = {
  stand:   { label: '🧍 Stand' },
  handsUp: { label: '🙌 Hands up', lArm: [0, 0, -2.6], rArm: [0, 0, 2.6] },
  tpose:   { label: '🤸 T-pose', lArm: [0, 0, -1.57], rArm: [0, 0, 1.57] },
  crouch:  { label: '🧎 Crouch', hipsY: 0.5, lThigh: [-1.4, 0, 0], rThigh: [-1.4, 0, 0], lShin: [1.4, 0, 0], rShin: [1.4, 0, 0], lArm: [-0.7, 0, -0.2], rArm: [-0.7, 0, 0.2], lFore: [-0.6, 0, 0], rFore: [-0.6, 0, 0] },
  sit:     { label: '🪑 Sit', hipsY: 0.12, lThigh: [-1.57, 0, -0.15], rThigh: [-1.57, 0, 0.15], lArm: [-0.9, 0, -0.1], rArm: [-0.9, 0, 0.1] },
  lie:     { label: '🛌 Lie down', hipsY: 0.2, hipsRot: [-1.57, 0, 0], lArm: [0, 0, -0.4], rArm: [0, 0, 0.4], head: [0.3, 0, 0] },
  wave:    { label: '👋 Wave', rArm: [0, 0, 2.9], rFore: [0, 0, -0.5], lArm: [-0.3, 0, -0.15], head: [0, 0, 0.15] },
};
const POSE_NAMES = Object.keys(POSES);

function applyPose(avatar, name) {
  const pose = POSES[name] || POSES.stand;
  const j = avatar.userData.joints;
  for (const k of Object.keys(j)) j[k].rotation.set(0, 0, 0);
  j.hips.position.y = pose.hipsY !== undefined ? pose.hipsY : 0.85;
  if (pose.hipsRot) j.hips.rotation.set(...pose.hipsRot);
  for (const k of Object.keys(j)) if (k !== 'hips' && pose[k]) j[k].rotation.set(...pose[k]);
  avatar.userData.pose = POSES[name] ? name : 'stand';
  // keep the tap volume around the body whatever the pose
  avatar.userData.hit.position.y = pose.hipsRot ? 0.25 : (pose.hipsY !== undefined ? pose.hipsY * 0.5 + 0.35 : 0.9);
}

function applyCamo(avatar, { color, texture }) {
  const mat = avatar.userData.material;
  if (mat.map) { mat.map.dispose(); mat.map = null; }
  mat.color.set(color || '#8a8a8a'); mat.needsUpdate = true;
  if (texture) {
    texLoader.load(texture, (tex) => {
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.repeat.set(2.5, 2.5); tex.colorSpace = THREE.SRGBColorSpace;
      mat.map = tex; mat.color.set('#ffffff'); mat.needsUpdate = true;
    });
  }
}

function makeLabel(text) {
  const c = document.createElement('canvas'); c.width = 256; c.height = 96;
  const x = c.getContext('2d');
  x.fillStyle = 'rgba(245,158,11,.95)'; x.beginPath(); x.roundRect(0, 0, 256, 96, 28); x.fill();
  x.fillStyle = '#111'; x.font = 'bold 52px system-ui, sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText(text, 128, 50);
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false }));
  s.scale.set(0.6, 0.22, 1); s.position.y = 1.95;
  return s;
}

/* ═══════════════════════════ device orientation → quaternion (fallback mode) ═══════════════════════════ */
const _zee = new THREE.Vector3(0, 0, 1), _euler = new THREE.Euler(), _q0 = new THREE.Quaternion();
const _q1 = new THREE.Quaternion(-Math.SQRT1_2, 0, 0, Math.SQRT1_2); // -PI/2 around X
function orientationToQuaternion(q, alpha, beta, gamma, orient) {
  _euler.set(beta, alpha, -gamma, 'YXZ');
  q.setFromEuler(_euler);
  q.multiply(_q1);
  q.multiply(_q0.setFromAxisAngle(_zee, -orient));
}

/* ═══════════════════════════ raw camera capture (WebXR camera-access) ═══════════════════════════ */
/** Copies the XR camera texture into a small readable framebuffer, using a minimal GL program. */
class CameraCapture {
  constructor(gl, size = 256) {
    this.gl = gl; this.size = size;
    const vs = `attribute vec2 p; varying vec2 v; void main(){ v = p * 0.5 + 0.5; gl_Position = vec4(p, 0.0, 1.0); }`;
    const fs = `precision mediump float; uniform sampler2D t; varying vec2 v; void main(){ gl_FragColor = texture2D(t, v); }`;
    const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); return s; };
    this.prog = gl.createProgram();
    gl.attachShader(this.prog, sh(gl.VERTEX_SHADER, vs)); gl.attachShader(this.prog, sh(gl.FRAGMENT_SHADER, fs)); gl.linkProgram(this.prog);
    this.aPos = gl.getAttribLocation(this.prog, 'p'); this.uTex = gl.getUniformLocation(this.prog, 't');
    this.vbo = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    this.tex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, size, size, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    this.fbo = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.tex, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this.pixels = new Uint8Array(size * size * 4);
  }
  /** Renders the camera texture into the FBO and reads it back. Must run inside the XR frame callback. */
  capture(cameraTexture) {
    const gl = this.gl, s = this.size;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
    gl.viewport(0, 0, s, s);
    gl.disable(gl.DEPTH_TEST); gl.disable(gl.BLEND); gl.disable(gl.CULL_FACE);
    gl.useProgram(this.prog);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, cameraTexture); gl.uniform1i(this.uTex, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo); gl.enableVertexAttribArray(this.aPos); gl.vertexAttribPointer(this.aPos, 2, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.readPixels(0, 0, s, s, gl.RGBA, gl.UNSIGNED_BYTE, this.pixels);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return { pixels: this.pixels, width: s, height: s, flipY: true };
  }
}

/** Averages a block of pixels and extracts a texture patch around (nx, ny) — normalized from top-left. */
function samplePixels({ pixels, width, height, flipY }, nx, ny, patchSize = 64) {
  const px = clamp(Math.round(nx * width), 0, width - 1);
  const py = clamp(Math.round((flipY ? 1 - ny : ny) * height), 0, height - 1);
  const half = 6; let r = 0, g = 0, b = 0, n = 0;
  for (let y = py - half; y <= py + half; y++) for (let x = px - half; x <= px + half; x++) {
    if (x < 0 || y < 0 || x >= width || y >= height) continue;
    const i = (y * width + x) * 4; r += pixels[i]; g += pixels[i + 1]; b += pixels[i + 2]; n++;
  }
  const hex = '#' + [r, g, b].map((v) => Math.round(v / n).toString(16).padStart(2, '0')).join('');
  // texture patch
  const ps = Math.min(patchSize, width, height);
  const c = document.createElement('canvas'); c.width = ps; c.height = ps;
  const img = c.getContext('2d').createImageData(ps, ps);
  const x0 = clamp(px - ps / 2, 0, width - ps), y0 = clamp(py - ps / 2, 0, height - ps);
  for (let y = 0; y < ps; y++) for (let x = 0; x < ps; x++) {
    const srcY = flipY ? (y0 + ps - 1 - y) : (y0 + y);
    const si = (srcY * width + x0 + x) * 4, di = (y * ps + x) * 4;
    img.data[di] = pixels[si]; img.data[di + 1] = pixels[si + 1]; img.data[di + 2] = pixels[si + 2]; img.data[di + 3] = 255;
  }
  c.getContext('2d').putImageData(img, 0, 0);
  return { color: hex, patch: c.toDataURL('image/jpeg', 0.7) };
}

/* ═══════════════════════════ AR session ═══════════════════════════ */
class ARSession {
  constructor(role) {
    this.role = role;                 // 'hider' | 'seeker' | 'watch'
    this.mode = null;                 // 'xr' | 'fallback'
    this.avatars = new Map();         // playerId → Group
    this.origin = new THREE.Matrix4(); this.originInv = new THREE.Matrix4();
    this.calibrated = false;
    this.pendingSample = null;
    this.draft = { placed: false, color: '#8a8a8a', patch: null, useTexture: true, scale: 1, rotationY: 0, pose: 'stand', lift: 0 };
    this.locked = false;
    this.orientation = { alpha: 0, beta: 0, gamma: 0, has: false };
    this.hitMatrix = null;
    this.tmp = { v: new THREE.Vector3(), q: new THREE.Quaternion(), s: new THREE.Vector3(), m: new THREE.Matrix4(), e: new THREE.Euler() };
  }

  /* ── lifecycle ── */
  async start() {
    // iOS: permission for orientation must be requested synchronously from the user gesture.
    let orientationPermission = null;
    if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
      orientationPermission = DeviceOrientationEvent.requestPermission().catch(() => 'denied');
    }
    const xrOK = !!(navigator.xr && await navigator.xr.isSessionSupported('immersive-ar').catch(() => false));
    this.mode = xrOK ? 'xr' : 'fallback';

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, 0.02, 60);
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x888888, 1.4));
    const dir = new THREE.DirectionalLight(0xffffff, 0.5); dir.position.set(1, 3, 1); this.scene.add(dir);
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.setSize(innerWidth, innerHeight);
    this.renderer.setClearColor(0x000000, 0);
    $('#arCanvasHost').appendChild(this.renderer.domElement);

    // placement reticle (ring on surfaces)
    this.reticle = new THREE.Mesh(new THREE.RingGeometry(0.08, 0.11, 32).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x22c55e }));
    this.reticle.matrixAutoUpdate = false; this.reticle.visible = false; this.scene.add(this.reticle);

    // my own avatar draft (hider)
    if (this.role === 'hider') { this.myAvatar = buildAvatar(state.id); this.myAvatar.visible = false; this.scene.add(this.myAvatar); }

    showScreen('ar');
    this.bindUI();
    if (this.mode === 'xr') await this.startXR();
    else await this.startFallback(orientationPermission);
    this.setStatus(this.mode === 'xr' ? 'AR tracking' : 'Camera + gyro mode');
    this.updateOverlay();
  }

  async startXR() {
    const overlay = $('#arOverlay');
    const session = await navigator.xr.requestSession('immersive-ar', {
      requiredFeatures: ['local', 'hit-test'],
      optionalFeatures: ['dom-overlay', 'camera-access', 'light-estimation'],
      domOverlay: { root: overlay },
    });
    this.session = session;
    this.renderer.xr.enabled = true;
    this.renderer.xr.setReferenceSpaceType('local');
    await this.renderer.xr.setSession(session);
    this.cameraAccess = !!(session.enabledFeatures && session.enabledFeatures.includes('camera-access'));
    const viewerSpace = await session.requestReferenceSpace('viewer');
    this.hitTestSource = await session.requestHitTestSource({ space: viewerSpace }).catch(() => null);
    session.addEventListener('end', () => this.stop(true));
    this.renderer.setAnimationLoop((t, frame) => this.frame(t, frame));
  }

  async startFallback(orientationPermission) {
    const video = $('#arVideo');
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } } });
    } catch (e) {
      throw new Error(/NotAllowed/i.test(e.name) ? 'Camera permission denied. Allow the camera and try again.' : 'Could not open the camera (' + e.name + ').');
    }
    video.srcObject = this.stream; video.hidden = false;
    await new Promise((res) => { video.onloadedmetadata = res; });
    await video.play();
    this.video = video;
    this.videoCanvas = document.createElement('canvas');

    // Gyroscope: the camera turns with the phone, so a placed avatar stays put in the room.
    this.onOrient = (e) => {
      if (e.alpha == null) return;
      this.orientation = { alpha: THREE.MathUtils.degToRad(e.alpha), beta: THREE.MathUtils.degToRad(e.beta || 0), gamma: THREE.MathUtils.degToRad(e.gamma || 0), has: true };
      if (!this.gyroOn) { this.gyroOn = true; this.setStatus('Camera + gyro'); $('#motionBtn').hidden = true; }
    };
    window.addEventListener('deviceorientation', this.onOrient, true);
    const perm = orientationPermission ? await orientationPermission : 'granted';
    if (perm !== 'granted') toast('Motion access was denied — tap "Enable motion" to try again.', 4000);
    // If no sensor data arrives, offer a button (iOS only grants motion access from a tap).
    setTimeout(() => { if (!this.stopped && !this.gyroOn) { $('#motionBtn').hidden = false; this.setStatus('Camera (no gyro)'); } }, 1500);

    // Drag-to-look for devices without motion sensors (desktop testing)
    this.drag = { yaw: 0, pitch: 0, active: false, x: 0, y: 0 };
    this.camera.position.set(0, 1.5, 0);
    this.onResize = () => { this.camera.aspect = innerWidth / innerHeight; this.camera.updateProjectionMatrix(); this.renderer.setSize(innerWidth, innerHeight); };
    window.addEventListener('resize', this.onResize);
    this.renderer.setAnimationLoop(() => this.frame());
  }

  stop(fromSession = false) {
    if (this.stopped) return; this.stopped = true;
    this.renderer.setAnimationLoop(null);
    if (this.session && !fromSession) this.session.end().catch(() => {});
    if (this.stream) this.stream.getTracks().forEach((t) => t.stop());
    if (this.video) { this.video.srcObject = null; this.video.hidden = true; }
    window.removeEventListener('deviceorientation', this.onOrient, true);
    window.removeEventListener('resize', this.onResize);
    this.unbindUI();
    this.renderer.dispose();
    this.renderer.domElement.remove();
    state.ar = null;
    if (state.room) showScreen('room'); else showScreen('lobby');
  }

  setStatus(t) { $('#hudStatus').textContent = t; }

  /** Re-requests motion-sensor access from a user tap (iOS Safari requirement). */
  async enableMotion() {
    if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
      const r = await DeviceOrientationEvent.requestPermission().catch(() => 'denied');
      if (r !== 'granted') { toast('Motion is blocked. iPhone: Settings → Safari → Motion & Orientation Access, then reload.', 6000); return; }
      toast('Motion sensors on — turn the phone and the avatar stays in place.', 2500);
    } else {
      toast('No motion sensors detected on this device — drag the screen to look around.', 4000);
    }
    setTimeout(() => { if (!this.gyroOn) toast('Still no sensor data. Make sure the phone is not in a case that blocks sensors, or reload the page.', 5000); }, 2000);
  }

  /* ── per-frame ── */
  frame(time, xrFrame) {
    if (this.mode === 'xr' && xrFrame) {
      const refSpace = this.renderer.xr.getReferenceSpace();
      // hit test → reticle
      if (this.hitTestSource && this.role === 'hider' && !this.locked) {
        const hits = xrFrame.getHitTestResults(this.hitTestSource);
        if (hits.length) {
          const pose = hits[0].getPose(refSpace);
          this.hitMatrix = this.hitMatrix || new THREE.Matrix4();
          this.hitMatrix.fromArray(pose.transform.matrix);
          this.reticle.matrix.copy(this.hitMatrix); this.reticle.visible = this.tool === 'place';
        } else { this.reticle.visible = false; this.hitMatrix = null; }
      } else this.reticle.visible = false;
      // eyedropper via raw camera access
      if (this.pendingSample) {
        const req = this.pendingSample; this.pendingSample = null;
        const pose = xrFrame.getViewerPose(refSpace);
        const view = pose && pose.views[0];
        if (this.cameraAccess && view && view.camera) {
          const gl = this.renderer.getContext();
          this.binding = this.binding || new XRWebGLBinding(this.session, gl);
          this.capture = this.capture || new CameraCapture(gl);
          const camTex = this.binding.getCameraImage(view.camera);
          const data = this.capture.capture(camTex);
          this.renderer.resetState();
          req.resolve(samplePixels(data, req.nx, req.ny));
        } else req.resolve(null);
      }
    } else if (this.mode === 'fallback') {
      if (this.orientation.has) {
        const orient = THREE.MathUtils.degToRad((screen.orientation && screen.orientation.angle) || window.orientation || 0);
        orientationToQuaternion(this.camera.quaternion, this.orientation.alpha, this.orientation.beta, this.orientation.gamma, orient);
      } else {
        this.tmp.e.set(this.drag.pitch, this.drag.yaw, 0, 'YXZ'); this.camera.quaternion.setFromEuler(this.tmp.e);
      }
      // keep the draft avatar in front of the camera before it is placed
      if (this.myAvatar && !this.draft.placed && this.calibrated && !this.locked) this.placeAhead(2);
    }
    this.tick();
    this.renderer.render(this.scene, this.camera);
  }

  /** Per-frame: joystick motion, projectiles, hit animations. */
  tick() {
    const now = performance.now();
    const dt = Math.min(0.05, (now - (this.lastTick || now)) / 1000); this.lastTick = now;
    // joystick → slide the avatar relative to where the camera looks; lift bar → up/down
    if (this.joy && (this.joy.x || this.joy.y || this.joy.lift) && this.myAvatar && this.draft.placed && !this.locked) {
      const { yaw } = this.cameraPose();
      const fwd = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw)), right = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
      const speed = 1.1 * dt;                                  // m/s at full deflection
      this.myAvatar.position.addScaledVector(right, this.joy.x * speed).addScaledVector(fwd, -this.joy.y * speed);
      this.myAvatar.position.y += this.joy.lift * 0.8 * dt;
      this.draft.lift = this.myAvatar.position.y - (this.mode === 'xr' ? this.myAvatar.position.y : 0);
    }
    // projectiles
    for (const pr of this.projectiles || []) {
      const k = Math.min(1, (now - pr.t0) / pr.dur);
      pr.mesh.position.lerpVectors(pr.from, pr.to, k);
      if (k >= 1) { this.scene.remove(pr.mesh); pr.done = true; pr.onArrive(); }
    }
    if (this.projectiles) this.projectiles = this.projectiles.filter((p) => !p.done);
    // hit animation: shot avatars topple over
    for (const av of this.avatars.values()) {
      if (av.userData.fallT0) {
        const k = Math.min(1, (now - av.userData.fallT0) / 600);
        const e = 1 - Math.pow(1 - k, 3);
        av.userData.joints.hips.rotation.x = av.userData.fallFrom + (-1.45 - av.userData.fallFrom) * e;
        av.userData.joints.hips.position.y = av.userData.fallY0 + (0.2 - av.userData.fallY0) * e;
        if (k >= 1) av.userData.fallT0 = 0;
      }
    }
  }

  /* ── coordinate frames ── */
  cameraPose() {
    // In XR three.js copies the XR view pose into this.camera each frame.
    this.camera.matrixWorld.decompose(this.tmp.v, this.tmp.q, this.tmp.s);
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(this.tmp.q); fwd.y = 0;
    const yaw = fwd.lengthSq() > 1e-6 ? Math.atan2(-fwd.x, -fwd.z) : 0;
    return { position: this.tmp.v.clone(), yaw };
  }
  calibrate() {
    const { position, yaw } = this.cameraPose();
    this.origin.makeRotationY(yaw).setPosition(position);
    this.originInv.copy(this.origin).invert();
    this.calibrated = true;
    $('#calibCard').hidden = true;
    toast('Origin set — coordinates are now shared');
    vibrate(40);
    if (this.role !== 'hider') this.syncAvatars(state.room);
    this.updateOverlay();
  }
  worldToRoom(pos, yaw) { return { position: pos.clone().applyMatrix4(this.originInv).toArray(), rotationY: yaw - this.originYaw() }; }
  roomToWorld(arr, yaw) { return { position: new THREE.Vector3().fromArray(arr).applyMatrix4(this.origin), rotationY: yaw + this.originYaw() }; }
  originYaw() { this.origin.decompose(this.tmp.v, this.tmp.q, this.tmp.s); const f = new THREE.Vector3(0, 0, -1).applyQuaternion(this.tmp.q); return Math.atan2(-f.x, -f.z); }

  /* ── hider actions ── */
  placeAhead(distance) {
    const { position, yaw } = this.cameraPose();
    const fwd = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
    const floorY = this.mode === 'xr' ? position.y - 1.4 : 0;
    this.myAvatar.position.set(position.x + fwd.x * distance, floorY, position.z + fwd.z * distance);
    this.myAvatar.rotation.y = yaw + Math.PI + this.draft.rotationY; // face the camera
    this.myAvatar.scale.setScalar(this.draft.scale);
    this.myAvatar.visible = true;
  }
  placeAtReticle() {
    if (this.mode === 'xr' && this.hitMatrix) {
      this.hitMatrix.decompose(this.tmp.v, this.tmp.q, this.tmp.s);
      const { yaw } = this.cameraPose();
      this.myAvatar.position.copy(this.tmp.v);
      this.myAvatar.rotation.set(0, yaw + Math.PI + this.draft.rotationY, 0);
      this.myAvatar.scale.setScalar(this.draft.scale);
      this.myAvatar.visible = true;
    } else this.placeAhead(this.mode === 'xr' ? 1.5 : 2);
    this.myAvatar.position.y += this.draft.lift;
    this.draft.placed = true;
    $('#readyBtn').disabled = false; $('#pads').hidden = false;
    $('#toolHint').innerHTML = 'Placed. Use the <b>joystick</b> to move it, the bar to raise/lower, ↺ ↻ to turn, pick a pose, then <b>Camouflage</b>.';
    vibrate(30);
  }
  rotate(delta) { this.draft.rotationY += delta; if (this.draft.placed) this.myAvatar.rotation.y += delta; }
  setScale(s) { this.draft.scale = s; if (this.myAvatar) this.myAvatar.scale.setScalar(s); }
  setPose(name) {
    this.draft.pose = name;
    applyPose(this.myAvatar, name);
    $$('#poseSeg button').forEach((b) => b.classList.toggle('is-active', b.dataset.pose === name));
  }
  lift(delta) {
    if (!this.draft.placed) return;
    this.draft.lift = clamp(this.draft.lift + delta, -1, 1.5);
    this.myAvatar.position.y += delta;
    toast(`Height ${this.draft.lift >= 0 ? '+' : ''}${this.draft.lift.toFixed(1)} m`, 800);
  }
  /** Drag: slide the placed avatar across the floor, relative to the finger movement (works even when the floor is off-screen). */
  dragBy(dxPx, dyPx) {
    if (!this.draft.placed) return;
    const { position: cam, yaw } = this.cameraPose();
    const fwd = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
    const right = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
    const dist = Math.max(1, this.myAvatar.position.distanceTo(cam));
    const k = dist * 0.0028;                      // metres per pixel, scaled by distance so far objects still move
    this.myAvatar.position.addScaledVector(right, dxPx * k).addScaledVector(fwd, -dyPx * k);
  }
  /** Auto camouflage: sample the live camera behind the avatar's own body (head, chest, hips). */
  async autoCamo() {
    if (!this.draft.placed) { toast('Place the avatar first'); return; }
    const pts = [1.5, 1.1, 0.7].map((y) => {
      const v = new THREE.Vector3(0, y * this.draft.scale, 0).applyMatrix4(this.myAvatar.matrixWorld);
      v.project(this.camera);
      return { nx: (v.x + 1) / 2, ny: (1 - v.y) / 2, ok: v.z < 1 && v.x > -1 && v.x < 1 && v.y > -1 && v.y < 1 };
    }).filter((p) => p.ok);
    if (!pts.length) { toast('Point the camera at your avatar first'); return; }
    this.myAvatar.visible = false;               // never sample our own pixels (fallback mode reads the video only, but XR reads the composed camera)
    const results = [];
    for (const p of pts) { const r = await this.sampleRaw(p.nx, p.ny); if (r) results.push(r); }
    this.myAvatar.visible = true;
    if (!results.length) { toast('Could not read the camera image — try the eyedropper.'); return; }
    const avg = [0, 1, 2].map((i) => Math.round(results.reduce((a, r) => a + parseInt(r.color.slice(1 + i * 2, 3 + i * 2), 16), 0) / results.length));
    this.draft.color = '#' + avg.map((v) => v.toString(16).padStart(2, '0')).join('');
    this.draft.patch = results[Math.floor(results.length / 2)].patch;
    this.applyDraftCamo();
    vibrate(20);
    toast(`Camouflaged as ${this.draft.color}`, 1500);
  }
  applyDraftCamo() {
    const useTex = this.draft.useTexture && this.draft.patch;
    applyCamo(this.myAvatar, { color: this.draft.color, texture: useTex ? this.draft.patch : null });
    $('#colorInput').value = this.draft.color;
    $('#patchPreview').style.backgroundImage = this.draft.patch ? `url(${this.draft.patch})` : 'none';
  }

  /** Eyedropper: sample the live camera at normalized screen coords and apply it. */
  async sampleAt(nx, ny) {
    if (this.mode === 'xr' && !this.cameraAccess) { toast('Live color sampling is not supported here — pick a color with the wheel.', 3500); return; }
    const result = await this.sampleRaw(nx, ny);
    if (!result) { toast('Could not read the camera image — try again.'); return; }
    this.draft.color = result.color; this.draft.patch = result.patch;
    this.applyDraftCamo();
    vibrate(20);
    toast(`Sampled ${result.color}`, 1200);
  }
  /** Reads colour + texture patch from the live camera at normalized coords; null if unavailable. */
  async sampleRaw(nx, ny) {
    let result = null;
    if (this.mode === 'xr') {
      if (!this.cameraAccess) return null;
      result = await new Promise((resolve) => { this.pendingSample = { nx, ny, resolve }; });
    } else {
      const v = this.video, c = this.videoCanvas;
      if (!v.videoWidth) return;
      // map the object-fit: cover viewport back onto the video frame
      const vw = v.videoWidth, vh = v.videoHeight, W = innerWidth, H = innerHeight;
      const s = Math.max(W / vw, H / vh);
      const dx = (W - vw * s) / 2, dy = (H - vh * s) / 2;
      const fx = clamp((nx * W - dx) / s / vw, 0, 1), fy = clamp((ny * H - dy) / s / vh, 0, 1);
      c.width = 320; c.height = Math.round(320 * vh / vw);
      const ctx = c.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(v, 0, 0, c.width, c.height);
      const pixels = ctx.getImageData(0, 0, c.width, c.height).data;
      result = samplePixels({ pixels, width: c.width, height: c.height, flipY: false }, fx, fy);
    }
    return result;
  }

  lock() {
    if (!this.draft.placed) return;
    const { position, rotationY } = this.worldToRoom(this.myAvatar.position, this.myAvatar.rotation.y);
    const useTex = this.draft.useTexture && this.draft.patch;
    net.emit('hider:ready', { position, rotationY, scale: this.draft.scale, color: this.draft.color, texture: useTex ? this.draft.patch : null, pose: this.draft.pose, mode: this.mode });
    this.locked = true; this.reticle.visible = false;
    this.updateOverlay();
  }
  unlock() { net.emit('hider:unready'); this.locked = false; this.updateOverlay(); }

  /* ── seeker / watch: render hidden avatars ── */
  syncAvatars(room) {
    if (!room || !this.calibrated) return;
    const reveal = room.phase === 'seek' || room.phase === 'results';
    for (const p of room.players) {
      if (p.role !== 'hider' || !p.hidden || !reveal || p.id === state.id) continue;
      let av = this.avatars.get(p.id);
      if (!av) {
        av = buildAvatar(p.id); this.avatars.set(p.id, av); this.scene.add(av);
        applyCamo(av, p.hidden); applyPose(av, p.hidden.pose);
        const { position, rotationY } = this.roomToWorld(p.hidden.position, p.hidden.rotationY);
        av.position.copy(position); av.rotation.set(0, rotationY, 0); av.scale.setScalar(p.hidden.scale || 1);
      }
      if (p.found && !av.userData.found) this.markFound(p.id, null);
    }
    for (const [id, av] of this.avatars) if (!room.players.some((p) => p.id === id)) { this.scene.remove(av); this.avatars.delete(id); }
    this.updateSeekerBar(room);
  }
  markFound(playerId, seekerName) {
    const av = this.avatars.get(playerId);
    if (av && !av.userData.found) {
      av.userData.found = true;
      av.userData.material.map = null; av.userData.material.color.set('#f59e0b'); av.userData.material.needsUpdate = true;
      av.add(makeLabel('HIT!'));
      av.userData.fallT0 = performance.now(); av.userData.fallFrom = av.userData.joints.hips.rotation.x; av.userData.fallY0 = av.userData.joints.hips.position.y;
    }
    if (this.role === 'hider' && playerId === state.id) { sfx('hit'); $('#hiderLockedText').textContent = `You were shot${seekerName ? ' by ' + seekerName : ''}! 💥`; }
    this.updateSeekerBar(state.room);
  }
  updateSeekerBar(room) {
    if (!room) return;
    const hs = room.players.filter((p) => p.role === 'hider');
    $('#seekerCount').textContent = `${hs.filter((p) => p.found).length} / ${hs.length} found`;
  }
  /** Seeker shot: a projectile flies from the phone toward the aim point; it counts if it hits an avatar. */
  fireAt(nx, ny) {
    const now = performance.now();
    if (this.lastShot && now - this.lastShot < 500) return;
    this.lastShot = now;
    sfx('shot'); vibrate(25);
    const btn = $('#fireBtn'); btn.classList.add('is-cooling'); setTimeout(() => btn.classList.remove('is-cooling'), 500);

    const ray = new THREE.Raycaster();
    this.camera.projectionMatrixInverse.copy(this.camera.projectionMatrix).invert();
    ray.setFromCamera(new THREE.Vector2(nx * 2 - 1, -(ny * 2 - 1)), this.camera);
    const targets = [...this.avatars.values()].filter((a) => !a.userData.found).map((a) => a.userData.hit);
    const hit = ray.intersectObjects(targets, false)[0];
    const from = ray.ray.origin.clone().add(ray.ray.direction.clone().multiplyScalar(0.3)).add(new THREE.Vector3(0, -0.12, 0));
    const to = hit ? hit.point.clone() : ray.ray.origin.clone().add(ray.ray.direction.clone().multiplyScalar(6));
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(0.035, 10, 8), new THREE.MeshBasicMaterial({ color: 0xfbbf24 }));
    mesh.position.copy(from); this.scene.add(mesh);
    this.projectiles = this.projectiles || [];
    this.projectiles.push({ mesh, from, to, t0: now, dur: Math.min(450, 80 + from.distanceTo(to) * 70), onArrive: () => {
      if (!hit) { $('#crosshair').classList.remove('is-hit'); return; }
      const id = hit.object.parent.userData.playerId;
      net.emit('seeker:found', { targetId: id }, (res) => {
        if (res && res.ok) { sfx('hit'); vibrate([60, 40, 120]); this.flash('HIT!'); this.markFound(id, state.name); }
      });
    } });
    $('#crosshair').classList.toggle('is-hit', !!hit);
  }
  flash(text) {
    const el = $('#flash'); el.textContent = text; el.hidden = false;
    el.style.animation = 'none'; void el.offsetWidth; el.style.animation = '';
    setTimeout(() => { el.hidden = true; }, 1600);
  }

  onRoomState(room) {
    if (this.role === 'hider') {
      const self = room.players.find((p) => p.id === state.id);
      if (room.phase === 'seek' && self) {
        $('#hiderLockedText').textContent = self.found ? 'You were found! 😱' : 'Seekers are looking… stay still 🤫';
        $('#unreadyBtn').hidden = true;
      } else if (room.phase === 'hide' && self && self.ready) {
        const hs = room.players.filter((p) => p.role === 'hider');
        $('#hiderLockedText').textContent = `Waiting for the other hiders (${hs.filter((p) => p.ready).length}/${hs.length} ready)…`;
      }
    } else this.syncAvatars(room);
  }

  /* ── overlay UI ── */
  updateOverlay() {
    const hider = this.role === 'hider';
    $('#calibCard').hidden = this.calibrated;
    $('#calibHint').textContent = this.mode === 'xr' ? 'Tip: mark the spot with tape so everyone calibrates identically.' : 'Gyro mode: you will also look around from this spot during the game.';
    $('#hiderTools').hidden = !(hider && this.calibrated && !this.locked);
    $('#hiderLocked').hidden = !(hider && this.locked);
    const seeking = this.role === 'seeker' && this.calibrated;
    $('#seekerBar').hidden = !(this.role !== 'hider' && this.calibrated);
    $('#crosshair').hidden = !seeking; $('#fireBtn').hidden = !seeking;
    $('#pads').hidden = !(hider && this.calibrated && !this.locked && this.tool === 'place' && this.draft.placed);
    $('#unreadyBtn').hidden = !(state.room && state.room.phase === 'hide');
    if (hider && this.calibrated && !this.locked) this.setTool(this.tool || 'place');
  }
  setTool(tool) {
    this.tool = tool;
    $$('#toolSeg button').forEach((b) => b.classList.toggle('is-active', b.dataset.tool === tool));
    $('#placeRow').hidden = tool !== 'place';
    $('#pads').hidden = !(tool === 'place' && this.draft.placed && !this.locked);
    $('#camoRow').hidden = tool !== 'camo';
    $('#toolHint').innerHTML = tool === 'place'
      ? (this.draft.placed ? 'Placed. Use the <b>joystick</b> to move it, the bar to raise/lower, ↺ ↻ to turn, pick a pose, then <b>Camouflage</b>.' : this.mode === 'xr' ? 'Aim at the floor or a surface, then tap <b>Place here</b>.' : 'Turn to face your hiding spot, then tap <b>Place here</b> (2 m ahead).')
      : 'Tap <b>Auto camouflage</b> to copy what is behind the avatar, or tap anywhere to sample that spot.';
  }
  bindUI() {
    this.handlers = [];
    const on = (sel, ev, fn) => { const el = $(sel); el.addEventListener(ev, fn); this.handlers.push([el, ev, fn]); };
    on('#arExitBtn', 'click', () => this.stop());
    on('#calibBtn', 'click', () => this.calibrate());
    on('#motionBtn', 'click', () => this.enableMotion());
    on('#toolSeg', 'click', (e) => { const b = e.target.closest('button'); if (b) this.setTool(b.dataset.tool); });
    on('#placeBtn', 'click', () => this.placeAtReticle());
    on('#rotLeft', 'click', () => this.rotate(Math.PI / 8));
    on('#rotRight', 'click', () => this.rotate(-Math.PI / 8));
    on('#scaleRange', 'input', (e) => this.setScale(parseFloat(e.target.value)));
    on('#fireBtn', 'pointerdown', (e) => { e.preventDefault(); if (state.room && state.room.phase === 'seek') this.fireAt(0.5, 0.5); });
    this.joy = { x: 0, y: 0, lift: 0 };
    const pad = (el, knob, onMove, onEnd) => {
      let pid = null;
      const rect = () => el.getBoundingClientRect();
      const upd = (e) => { const r = rect(); onMove((e.clientX - (r.left + r.width / 2)) / (r.width / 2), (e.clientY - (r.top + r.height / 2)) / (r.height / 2), knob, r); };
      on('#' + el.id, 'pointerdown', (e) => { pid = e.pointerId; el.setPointerCapture(pid); e.preventDefault(); e.stopPropagation(); upd(e); });
      on('#' + el.id, 'pointermove', (e) => { if (e.pointerId === pid) { e.preventDefault(); upd(e); } });
      const end = (e) => { if (e.pointerId === pid) { pid = null; onEnd(knob); } };
      on('#' + el.id, 'pointerup', end); on('#' + el.id, 'pointercancel', end);
    };
    pad($('#joy'), $('#joyKnob'), (x, y, knob, r) => {
      const len = Math.hypot(x, y) || 1, k = Math.min(1, len);
      this.joy.x = (x / len) * k; this.joy.y = (y / len) * k;
      knob.style.transform = `translate(calc(-50% + ${this.joy.x * r.width * 0.32}px), calc(-50% + ${this.joy.y * r.height * 0.32}px))`;
    }, (knob) => { this.joy.x = 0; this.joy.y = 0; knob.style.transform = 'translate(-50%, -50%)'; });
    pad($('#liftBar'), $('#liftKnob'), (x, y, knob, r) => {
      this.joy.lift = -Math.max(-1, Math.min(1, y));
      knob.style.transform = `translate(-50%, calc(-50% + ${Math.max(-1, Math.min(1, y)) * r.height * 0.36}px))`;
    }, (knob) => { this.joy.lift = 0; knob.style.transform = 'translate(-50%, -50%)'; });
    on('#poseSeg', 'click', (e) => { const b = e.target.closest('button'); if (b) this.setPose(b.dataset.pose); });
    on('#autoCamoBtn', 'click', () => this.autoCamo());
    on('#colorInput', 'input', (e) => { this.draft.color = e.target.value; this.draft.patch = null; this.applyDraftCamo(); });
    on('#textureToggle', 'change', (e) => { this.draft.useTexture = e.target.checked; this.applyDraftCamo(); });
    on('#readyBtn', 'click', () => this.lock());
    on('#unreadyBtn', 'click', () => this.unlock());

    // Taps on the transparent overlay area = interact with the scene.
    const overlay = $('#arOverlay');
    const isUI = (t) => t.closest('button, input, label, select, .card, .tools, .seg, .hud, .pads, .fire');
    const down = (e) => {
      if (isUI(e.target)) return;
      e.preventDefault();
      const nx = e.clientX / innerWidth, ny = e.clientY / innerHeight;
      this.pointer = { x: e.clientX, y: e.clientY, moved: false, nx, ny };
      if (this.mode === 'fallback' && !this.orientation.has) { this.drag.active = true; this.drag.x = e.clientX; this.drag.y = e.clientY; }
    };
    const move = (e) => {
      if (!this.pointer) return;
      if (Math.hypot(e.clientX - this.pointer.x, e.clientY - this.pointer.y) > 8) this.pointer.moved = true;
      if (this.pointer.moved && this.role === 'hider' && !this.locked && this.tool === 'place' && this.draft.placed && this.calibrated) {
        this.dragBy(e.clientX - (this.pointer.lx ?? e.clientX), e.clientY - (this.pointer.ly ?? e.clientY));
        this.pointer.lx = e.clientX; this.pointer.ly = e.clientY;
        return;
      }
      if (this.drag && this.drag.active) {
        this.drag.yaw -= (e.clientX - this.drag.x) * 0.005; this.drag.pitch = clamp(this.drag.pitch - (e.clientY - this.drag.y) * 0.005, -1.2, 1.2);
        this.drag.x = e.clientX; this.drag.y = e.clientY;
      }
    };
    const up = () => {
      if (this.drag) this.drag.active = false;
      const p = this.pointer; this.pointer = null;
      if (!p || p.moved || !this.calibrated) return;
      if (this.role === 'hider' && !this.locked) {
        if (this.tool === 'camo') this.sampleAt(p.nx, p.ny);
        else this.placeAtReticle();
      } else if (this.role === 'seeker' && state.room && state.room.phase === 'seek') this.fireAt(p.nx, p.ny);
    };
    on('#arOverlay', 'pointerdown', down); on('#arOverlay', 'pointermove', move); on('#arOverlay', 'pointerup', up); on('#arOverlay', 'pointercancel', up);
    overlay.addEventListener('contextmenu', (e) => e.preventDefault());
  }
  unbindUI() { (this.handlers || []).forEach(([el, ev, fn]) => el.removeEventListener(ev, fn)); this.handlers = []; }
}

/* pose picker buttons */
$('#poseSeg').innerHTML = POSE_NAMES.map((k) => `<button type="button" data-pose="${k}"${k === 'stand' ? ' class="is-active"' : ''}>${POSES[k].label}</button>`).join('');

/* ═══════════════════════════ entry ═══════════════════════════ */
async function enterAR(role) {
  if (state.ar) return;
  if (!(location.protocol === 'https:' || location.hostname === 'localhost')) return toast('The camera needs HTTPS. Open the https:// address.', 4000);
  // reset overlay widgets
  $('#readyBtn').disabled = true; $('#scaleRange').value = 1; $('#colorInput').value = '#8a8a8a'; $('#textureToggle').checked = true; $('#patchPreview').style.backgroundImage = 'none';
  $('#hiderLockedText').textContent = 'Waiting for the other hiders…';
  $$('#poseSeg button').forEach((b) => b.classList.toggle('is-active', b.dataset.pose === 'stand'));
  const ar = new ARSession(role);
  state.ar = ar;
  try { await ar.start(); }
  catch (e) { console.error(e); toast(e.message || 'Could not start AR', 4000); ar.stop(); }
}

/* Debug handle (inspect from the console on a phone via remote devtools). */
window.meccha = { state, POSES };
