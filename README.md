# 🎤 Mimic Party

A mobile web voice party game: every phone plays a short sound at the same instant, everyone
mimics it into their microphone **at the same time** (no turns), the phone analyses the voice
locally (pitch + rhythm) and the room gets a leaderboard — plus silly playback effects.

**Stack:** React 18 + Tailwind (Vite, TypeScript) · Node.js + Express + Socket.io · Web Audio API
(pitch detection, synthesised sounds, effects) · MediaRecorder (the recording you hear back).

## Play it

### Option A — GitHub Pages, no server (phones only)
Every push builds `dist/` and publishes it to the `gh-pages` branch. One-time: **Settings → Pages →
Source: Deploy from a branch → `gh-pages` / (root)**. Open the page on each phone; the player who
creates the room becomes the host — their phone runs the room logic and the others connect to it
directly over WebRTC (PeerJS signalling). The host keeps the page open.

### Option B — Node server (Socket.io)
```bash
npm install
npm run build            # client → dist/
npm run certs            # one-time self-signed cert (the mic needs HTTPS on phones)
npm start                # https://localhost:3000  → open https://<LAN-IP>:3000 on the phones
```
On Glitch / Replit / Render: `npm install && npm run build && npm start` (they provide HTTPS).

Development: `npm run dev` (Vite on :5173, proxies `/socket.io` and `/api` to `npm start` on :3000).
Tests: `npm test` (room state machine + scoring).

## Folder structure

```
├─ server.js                 Express static host + Socket.io transport (thin; rules live in shared/)
├─ shared/
│  ├─ game-core.js           GameRoom: lobby → listen → record → results → final, timers, submissions
│  └─ sounds.js              sound library (synth definitions → playback, reference contour, onsets)
├─ src/
│  ├─ main.tsx, App.tsx      bootstrap, transport wiring, screen routing
│  ├─ net/transport.ts       Socket.io or serverless WebRTC — same API; host-clock sync
│  ├─ audio/pitch.ts         McLeod pitch detector (NSDF + parabolic interpolation)
│  ├─ audio/recorder.ts      getUserMedia + MediaRecorder + 20 ms analyser frames
│  ├─ audio/synth.ts         plays the reference sounds (Web Audio), audio unlock, blips
│  ├─ audio/effects.ts       chipmunk / giant / robot / cave / reverse playback
│  ├─ game/scoring.ts        DTW pitch score + onset rhythm score → 0–100
│  ├─ components/PitchGraph  reference vs. voice contour canvas
│  └─ screens/               Join → Lobby → Round (listen, countdown, record) → Results → Final
├─ test/                     core.test.js, scoring.test.js
└─ .github/workflows/        build + publish to gh-pages
```

## How a round is synchronised

1. Host taps **Start**. The room picks a sound and computes absolute host-clock timestamps:
   `listenAt = now + 1.5 s`, `recordAt = listenAt + soundLength + 3 s`, `recordEndAt = recordAt + window (3–5 s)`.
2. Every client measured its clock offset to the host (5 pings, median), so it schedules the
   reference playback on the AudioContext clock and starts `MediaRecorder` at exactly `recordAt`.
3. During recording the analyser feeds `detectPitch()` every 20 ms → frames `{t, f, clarity, rms}`.
4. At `recordEndAt` the phone scores itself (`scorePerformance`) and submits `{score, pitch, rhythm,
   contour, audio(dataURL ≤ 400 KB), title}`. Results publish when everyone submitted or 8 s later.

## Scoring (client-side)

- Both contours → semitones on a 20 ms grid; octave errors of the detector are folded; 3-point median filter.
- A global shift (0–1.2 s) absorbs reaction delay.
- **Pitch (60 %)**: dynamic time warping between the reference and the recording after each is centred
  on its own median (so singing an octave lower is fine — the *shape* counts), scaled by how much of the
  sound you actually voiced.
- **Rhythm (40 %)**: onsets of your voiced segments vs. the note onsets of the sound, plus total voiced
  duration.

## Protocol (Socket.io and WebRTC carry the same events)

| Client → host | Payload |
|---|---|
| `room:create` / `room:join` | `{name, avatar}` / `{code, name, avatar}` |
| `time:ping` | `{t}` → ack `{serverNow}` |
| `player:ready` | `{ready}` |
| `room:settings` | `{rounds}` (host) |
| `round:start` | `{soundId?}` (host) |
| `round:submit` | `{score, pitch, rhythm, contour, audio, title}` |
| `game:end`, `game:reset` | (host) |

| Host → clients | Payload |
|---|---|
| `room:joined` | `{code, id}` |
| `room:state` | full snapshot (no audio) |
| `round:start` | `{n, of, soundId, listenAt, recordAt, recordEndAt, submitDeadline, serverNow}` |
| `round:results` | `{n, soundId, results[{…, audio}], standings}` |
| `game:final` | `{standings, rounds}` |
| `error:msg`, `room:closed` | `{message}` |
