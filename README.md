# Meccha — WebAR Multiplayer Hide & Seek

A browser-only, multi-phone hide & seek inspired by *MECCHA CHAMELEON*: hiders place a 3D avatar
in the real room through the camera and camouflage it with the colour/texture of whatever is behind
it; seekers walk around with their phones and tap the avatars they spot.

- **Backend:** Node.js · Express · Socket.io (`server.js`)
- **Frontend:** HTML5 · ES modules · Three.js (unpkg) · WebXR `immersive-ar` with hit-test, DOM overlay and
  raw camera access; camera + gyroscope fallback for browsers without WebXR (iOS Safari)

## Run it

```bash
npm install
npm run certs      # one-time: self-signed certificate so phones can use the camera
npm start          # → https://localhost:3000
```

Open `https://<your-computer-LAN-IP>:3000` on each phone (same Wi-Fi) and accept the certificate
warning. On **Glitch / Replit / Render** just `npm start` — they provide HTTPS, no certs needed.

`npm test` runs an end-to-end game-flow test with three socket clients.

## How a round works

1. **Lobby** — one player creates a room (4-letter code), the others join; everyone picks
   *Hider* or *Seeker*. The host sets hide/seek timers and starts.
2. **Hide phase** — hiders tap *Enter AR & hide*:
   - **Set origin**: every player calibrates from the same physical spot facing the same wall
     (mark it with tape). This puts all phones in one shared coordinate frame.
   - **Place**: aim at the floor/surface and tap *Place here* (WebXR hit-test), rotate and resize.
   - **Camouflage**: tap the wall/furniture behind the avatar. The eyedropper reads the live camera
     pixels, averages the colour and grabs a 64×64 texture patch which is applied to the avatar.
   - **Ready** locks position, rotation, scale, colour and texture and sends them to the server.
3. **Seek phase** — starts when all hiders are ready (or the timer ends). Seekers tap
   *Enter AR & seek*, calibrate from the same spot, and the hidden avatars appear at their real
   positions. Tapping one raycasts into the scene and emits `seeker:found`; everybody gets a
   `player:found` event, the avatar lights up with a **FOUND!** label.
4. **Results** — seekers win if every hider was found before the timer.

## Socket.io protocol

| Client → server | Payload | Notes |
|---|---|---|
| `room:create` | `{name, role}` | creates room, caller becomes host |
| `room:join` | `{code, name, role}` | |
| `room:leave` | | |
| `player:role` | `{role}` | lobby only |
| `player:name` | `{name}` | |
| `room:settings` | `{hideSeconds, seekSeconds}` | host only |
| `game:start` | | host only, needs ≥1 hider and ≥1 seeker |
| `hider:ready` | `{position:[x,y,z], rotationY, scale, color, texture, mode}` | validated server-side |
| `hider:unready` | | |
| `seeker:found` | `{targetId}` + ack `{ok}` | seek phase only |
| `game:reset` | | host only |

| Server → client | Payload |
|---|---|
| `room:joined` | `{code, id}` |
| `room:state` | full room snapshot (hidden data only revealed in seek/results) |
| `game:phase` | `{phase, endsAt, serverNow}` |
| `game:seekStart` | `{reason}` |
| `player:found` | `{targetId, targetName, seekerId, seekerName, at}` |
| `game:results` | `{reason, winner, foundCount, hiderCount}` |
| `error:msg` | `{message}` |

## Browser support

| | Tracking | Eyedropper |
|---|---|---|
| Android Chrome (ARCore) | WebXR 6-DoF, hit-test placement | raw camera access (`camera-access` feature) |
| iOS Safari / others | camera video + gyroscope (3-DoF, fixed standpoint) | reads the `<video>` frame |

In gyro mode everyone plays from the calibration spot and looks around; avatars are placed 2 m
ahead in the chosen direction. For the full walk-around experience use Android Chrome.
