# سيفين ونخله — منصة الويب للتحديات

**Two Swords & a Palm** is a browser-based (WebAR + GPS) scavenger-hunt platform.
Players open a link, grant camera/location permission, and play directly in the
browser — no app install. This repository contains the creator/player dashboard.

> ما تجمعه هو الهدية — *What you collect is the gift.*

## Features

| Panel | What it does |
| --- | --- |
| **WebAR Engine** | In-page camera + GPS permission sheet, then a live [MindAR.js](https://hiukim.github.io/mind-ar-js-doc/) image-tracking scene (A-Frame) that overlays a floating golden sword on the recognised target. A "simulate" mode plays the same flow without a camera. |
| **Scavenger Hunt Status** | Sequential stages with Arabic riddles; each stage unlocks when the previous one is collected. Live distance to each drop when GPS is on. |
| **Browser GPS Map** | Leaflet map of drops across Riyadh with unlock-radius rings, the player's live position, click-to-add custom drops, and an *Indoor Image Markers* mode. Uses **Mapbox** tiles when a token is set, otherwise OpenStreetMap. |
| **Share** | Generates a challenge link and opens it in WhatsApp (uses the Web Share API on mobile). |
| **Live Dashboard** | Real-time leaderboard (simulated feed), 1,000 SAR prize pool, and a digital-wallet claim flow. |
| **Portfolio & Store** | Player points/items and purchasable power-ups (item magnet, extended radar — the radar triples the GPS unlock radius). |

Fully responsive: three columns on desktop, single column with a bottom tab bar on mobile. RTL Arabic UI.

## Run it

It's a static site — no build step.

```bash
# any static server works; camera/GPS APIs need localhost or HTTPS
npx serve .            # → http://localhost:3000
# or
python3 -m http.server 8080
```

Open the URL on desktop, or on a phone over HTTPS (e.g. `npx serve --ssl-cert … --ssl-key …`, or a tunnel like `ngrok`) to test the real camera.

## Configure

Everything lives in [`config.js`](config.js):

- `mapbox.accessToken` — optional; enables Mapbox tiles (also editable in the Settings panel).
- `ar.targetSrc` — a compiled MindAR `.mind` image target. Compile your own (e.g. the coffee-cup logo) with the
  [MindAR image-target compiler](https://hiukim.github.io/mind-ar-js-doc/tools/compile) and point this at the file.
  The default is MindAR's sample card so the AR scene works out of the box.
- `challenge.stages` — titles, riddles, coordinates, points, and `type` (`outdoor` GPS drop or `indoor` image marker).
- `map.unlockRadiusMeters`, `prizePool`, `store`, `leaderboard`, `player`.

Progress (points, collected items, purchases, settings) is stored in `localStorage`.
The leaderboard "live feed" is a client-side simulation — swap `liveTick()` in `js/app.js` for a
websocket/SSE subscription to sync real players.

## Project layout

```
index.html      dashboard markup + SVG icon sprite
config.js       hunt content & integration settings
css/style.css   green/gold/white theme, responsive layout
js/map.js       HuntMap — Leaflet map, Mapbox/OSM tiles, drops, player position
js/ar.js        HuntAR  — lazy-loads A-Frame + MindAR, permission flow, target events
js/app.js       state, rendering, collect/buy/claim/share flows, navigation
```
