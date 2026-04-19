# UNO — Multiplayer

Realtime multiplayer UNO. Node.js + Express + Socket.IO server, vanilla JS client.

## Run locally

```bash
npm install
npm start
```

Open http://localhost:3000. Create a room, share the 4-letter code, and start once ≥2 players have joined.

Dev mode (auto-restarts on file changes):

```bash
npm run dev
```

## How it plays

- 2–8 players per room.
- Standard UNO deck: 108 cards with skip, reverse, draw 2, wild, wild draw 4.
- Draw-stack chaining: +2 / +4 can be stacked onto each other; the next player either plays another +2/+4 or draws the total.
- After drawing a single card on your turn, the turn passes (no "play-what-you-draw" auto-play).
- Click your playable cards (highlighted in yellow) to play. Wilds prompt for a color.
- Hit **UNO!** when you're down to 1 card.

## Deploy to Render

This repo has a `render.yaml` for Blueprint deploys.

1. Push to GitHub.
2. In Render: **New → Blueprint** → point at the repo.
3. Render picks up `render.yaml` and provisions a free web service running `npm install` + `npm start`.

Socket.IO works over Render's standard HTTPS — no extra config needed. Render's free tier spins down after inactivity; first request wakes it up.

Game state is in-memory only. Restarts drop active games.

## Project layout

```
server.js          Express + Socket.IO, room management
src/game.js        UNO engine — deck, rules, turns
public/            Static client (index.html, style.css, client.js)
render.yaml        Render Blueprint config
```
