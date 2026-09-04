# Meccha — WebAR Multiplayer Hide & Seek

A browser-only, multi-phone hide & seek inspired by *MECCHA CHAMELEON*: hiders place a 3D avatar
in the real room through the camera and camouflage it with the colour/texture of whatever is behind
it; seekers walk around with their phones and tap the avatars they spot.

- **Frontend:** HTML5 · ES modules · Three.js · WebXR `immersive-ar` (hit-test, DOM overlay, raw camera
  access) with a camera + gyroscope fallback for browsers without WebXR (iOS Safari)
- **Backend, two interchangeable modes sharing one game core (`public/game-core.js`):**
  - **Socket.io** — `server.js` (Node.js · Express · Socket.io) for Glitch / Replit / Render / your laptop.
  - **Serverless** — on static hosting (GitHub Pages) the host's phone runs the game core and the other
    phones connect to it directly over WebRTC data channels (PeerJS signalling). No backend at all.

## Play from GitHub Pages (no laptop needed)

1. In the repo: **Settings → Pages → Source: Deploy from a branch → `gh-pages` / (root) → Save**
   (one time; the workflow keeps `gh-pages` updated on every push).
2. Open **https://engfm0.github.io/Game/** on every phone. Create a room on one phone, share the
   code or the link, join on the others. The host must keep the page open.

## Run with the Node server

```bash
npm install
npm run certs      # one-time: self-signed certificate so phones can use the camera on your LAN
npm start          # → https://localhost:3000, open https://<LAN-IP>:3000 on the phones
npm test           # end-to-end game-flow test with three socket clients
```
On Glitch / Replit / Render just `npm start`; they provide HTTPS.

## How a round works

1. **Lobby** — one player creates a room (4-letter code), the others join; everyone picks *Hider* or
   *Seeker*. The host sets the hide/seek timers and starts.
2. **Hide phase** — hiders tap *Enter AR & hide*:
   - **Set origin**: every player calibrates from the same physical spot facing the same wall (mark it
     with tape). This puts all phones in one shared coordinate frame.
   - **Place**: aim at the floor/surface and tap *Place here* (WebXR hit-test), rotate and resize.
   - **Camouflage**: tap the wall/furniture behind the avatar. The eyedropper reads the live camera
     pixels, averages the colour and grabs a 64×64 texture patch which is applied to the avatar.
   - **Ready** locks position, rotation, scale, colour and texture.
3. **Seek phase** — starts when all hiders are ready (or the timer ends). Seekers tap *Enter AR & seek*,
   calibrate from the same spot, and the hidden avatars appear at their real positions. Tapping one
   raycasts into the scene; everybody gets a `player:found` event and the avatar lights up **FOUND!**
4. **Results** — seekers win if every hider was found before the timer.

## Game protocol (same in both modes)

| Client → host | Payload | Notes |
|---|---|---|
| `room:create` | `{name, role}` | caller becomes host |
| `room:join` | `{code, name, role}` | |
| `room:leave` | | |
| `player:role` | `{role}` | lobby only |
| `player:name` | `{name}` | |
| `room:settings` | `{hideSeconds, seekSeconds}` | host only |
| `game:start` | | host only, needs ≥1 hider and ≥1 seeker |
| `hider:ready` | `{position:[x,y,z], rotationY, scale, color, texture, mode}` | validated by the core |
| `hider:unready` | | |
| `seeker:found` | `{targetId}` + ack `{ok}` | seek phase only |
| `game:reset` | | host only |

| Host → clients | Payload |
|---|---|
| `room:joined` | `{code, id}` |
| `room:state` | full room snapshot (hidden data only revealed in seek/results) |
| `game:phase` | `{phase, endsAt, serverNow}` |
| `game:seekStart` | `{reason}` |
| `player:found` | `{targetId, targetName, seekerId, seekerName, at}` |
| `game:results` | `{reason, winner, foundCount, hiderCount}` |
| `error:msg` | `{message}` |
| `room:closed` | `{message}` (serverless mode, when the host leaves) |

## Files

| File | Role |
|---|---|
| `public/index.html`, `style.css` | screens: lobby, room, AR overlay, results |
| `public/app.js` | Three.js AR client, calibration, placement, eyedropper, raycast tapping |
| `public/net.js` | transport: Socket.io or WebRTC (PeerJS), same API |
| `public/game-core.js` | room state machine shared by the Node server and the host phone |
| `server.js` | Express + Socket.io wrapper around the core |
| `test/flow.test.js` | end-to-end flow test (`npm test`) |

## Browser support

| | Tracking | Eyedropper |
|---|---|---|
| Android Chrome (ARCore) | WebXR 6-DoF, hit-test placement | raw camera access (`camera-access`) |
| iOS Safari / others | camera video + gyroscope (3-DoF, fixed standpoint) | reads the `<video>` frame |

In gyro mode everyone plays from the calibration spot and looks around; avatars are placed 2 m ahead in
the chosen direction. For the full walk-around experience use Android Chrome.
