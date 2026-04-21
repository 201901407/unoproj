# 🃏 Play UNO Online Free — Multiplayer Card Game

**Play UNO online with friends instantly — no download, no signup, no account required.**
A free browser-based multiplayer UNO card game supporting 2–8 players in real time.

🔴 **[Play Now!!](https://unoproj.onrender.com)**

---

## Why This UNO?

- ✅ **Free & instant** — share a 4-letter room code and you're in
- ✅ **No download, no signup** — runs entirely in the browser
- ✅ **2–8 players** per room
- ✅ **Full UNO rules** — standard 108-card deck with all card types
- ✅ **Draw-stack chaining** — stack +2s and +4s like real UNO
- ✅ **Real-time gameplay** — powered by WebSockets, zero lag

---

## How to Play UNO Online

1. Go to **[unoproj.onrender.com](https://unoproj.onrender.com)**
2. Create a room — you'll get a 4-letter code
3. Share the code with friends (works on any device with a browser)
4. Start the game once at least 2 players have joined
5. Playable cards are highlighted in yellow — click to play
6. Hit **UNO!** when you're down to your last card

### Card Rules

| Card | Effect |
|------|--------|
| Skip | Next player loses their turn |
| Reverse | Reverses turn order |
| Draw 2 | Next player draws 2 (or stacks another +2/+4) |
| Wild | Choose any color |
| Wild Draw 4 | Choose color + next player draws 4 (stackable) |

**Draw-stack chaining:** If a +2 or +4 is played on you, you can play another +2 or +4 to pass the stack forward. The unlucky player at the end draws the total accumulated cards.

After drawing a card on your turn, the turn passes automatically — no play-what-you-draw.

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Server | Node.js + Express |
| Real-time | Socket.IO (WebSockets) |
| Client | Vanilla JavaScript, HTML, CSS |
| Hosting | Render (free tier) |

---

## Run Locally

```bash
git clone https://github.com/201901407/unoproj.git
cd unoproj
npm install
npm start
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

**Dev mode** (auto-restarts on file changes):

```bash
npm run dev
```

---

## Project Structure

```
server.js        Express + Socket.IO — room management & game events
src/game.js      UNO engine — deck, rules, turn logic
public/          Static client (index.html, style.css, client.js)
render.yaml      Render Blueprint deploy config
```

---

*Built with Node.js and Socket.IO. Play UNO online free with friends — no download needed.*
