import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import { fileURLToPath } from 'url';
import path from 'path';
import { createGame, playCard, drawTurn, skipTurn, callUno, publicState, removeFromGame, currentPlayer, drawCards } from './src/game.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

const rooms = new Map();
const PRE_GAME_GRACE_MS = 30_000;
const TURN_TIMEOUT_MS = 30_000;
const UNO_PENALTY_MS = 2_000;

function makeRoomCode() {
  const letters = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code;
  do {
    code = Array.from({ length: 4 }, () => letters[Math.floor(Math.random() * letters.length)]).join('');
  } while (rooms.has(code));
  return code;
}

function getRoom(code) {
  return rooms.get(code);
}

function broadcastRoom(code) {
  const room = getRoom(code);
  if (!room) return;
  const lobby = {
    code,
    hostId: room.hostId,
    players: room.players.map(p => ({ id: p.id, name: p.name, connected: p.connected })),
    started: !!room.game,
  };
  io.to(code).emit('lobby', lobby);
  if (room.game) {
    for (const p of room.players) {
      if (!p.socketId) continue;
      const state = publicState(room.game, p.id);
      state.turnDeadline = room.turnDeadline || null;
      state.unoPenaltyFor = room.unoPenaltyFor || null;
      state.unoPenaltyDeadline = room.unoPenaltyDeadline || null;
      io.to(p.socketId).emit('state', state);
    }
  }
}

function clearUnoPenalty(room) {
  if (!room) return;
  if (room.unoPenaltyTimer) clearTimeout(room.unoPenaltyTimer);
  room.unoPenaltyTimer = null;
  room.unoPenaltyFor = null;
  room.unoPenaltyDeadline = null;
}

function armUnoPenalty(code, playerId) {
  const room = getRoom(code);
  if (!room?.game || room.game.winnerId) return;
  clearUnoPenalty(room);
  room.unoPenaltyFor = playerId;
  room.unoPenaltyDeadline = Date.now() + UNO_PENALTY_MS;
  room.unoPenaltyTimer = setTimeout(() => {
    const r = getRoom(code);
    if (!r?.game || r.game.winnerId) return;
    if (r.unoPenaltyFor !== playerId) return;
    if (r.game.unoCalls[playerId]) { clearUnoPenalty(r); return; }
    const hand = r.game.hands[playerId];
    if (!hand || hand.length !== 1) { clearUnoPenalty(r); return; }
    drawCards(r.game, playerId, 2);
    r.game.lastAction = { type: 'uno-penalty', playerId };
    clearUnoPenalty(r);
    const name = r.players.find(p => p.id === playerId)?.name || 'Player';
    io.to(code).emit('notice', { message: `${name} forgot UNO! +2 cards.` });
    broadcastRoom(code);
  }, UNO_PENALTY_MS);
}

function clearTurnTimer(room) {
  if (!room) return;
  if (room.turnTimer) clearTimeout(room.turnTimer);
  room.turnTimer = null;
  room.turnTimerFor = null;
  room.turnDeadline = null;
}

function armTurnTimer(code) {
  const room = getRoom(code);
  if (!room?.game || room.game.winnerId) {
    clearTurnTimer(room);
    return;
  }
  const currentId = currentPlayer(room.game).id;
  if (room.turnTimerFor === currentId && room.turnTimer) return;
  clearTurnTimer(room);
  room.turnTimerFor = currentId;
  room.turnDeadline = Date.now() + TURN_TIMEOUT_MS;
  room.turnTimer = setTimeout(() => {
    const r = getRoom(code);
    if (!r?.game || r.game.winnerId) return;
    if (currentPlayer(r.game).id !== currentId) return;
    handleTurnTimeout(code, currentId);
  }, TURN_TIMEOUT_MS);
}

function handleTurnTimeout(code, playerId) {
  const room = getRoom(code);
  if (!room?.game) return;
  const droppedSocketId = room.players.find(p => p.id === playerId)?.socketId;
  removeFromGame(room.game, playerId);
  room.players = room.players.filter(p => p.id !== playerId);
  if (room.hostId === playerId && room.players.length > 0) {
    room.hostId = (room.players.find(p => p.connected) || room.players[0]).id;
  }
  if (droppedSocketId) {
    io.to(droppedSocketId).emit('kicked', { reason: 'inactive' });
  }
  clearTurnTimer(room);
  if (room.unoPenaltyFor === playerId) clearUnoPenalty(room);
  if (room.players.length === 0) {
    rooms.delete(code);
    return;
  }
  if (room.players.length < 2) {
    clearUnoPenalty(room);
    room.game = null;
    io.to(code).emit('notice', { message: 'Not enough players. Game ended.' });
    broadcastRoom(code);
    return;
  }
  broadcastRoom(code);
  if (!room.game.winnerId) armTurnTimer(code);
}

function removePlayer(code, playerId) {
  const room = getRoom(code);
  if (!room) return;
  room.players = room.players.filter(p => p.id !== playerId);
  if (room.players.length === 0) {
    rooms.delete(code);
    return;
  }
  if (room.hostId === playerId) {
    room.hostId = (room.players.find(p => p.connected) || room.players[0]).id;
  }
  broadcastRoom(code);
}

function attachSocketToPlayer(player, socket, code) {
  if (player.removalTimeout) {
    clearTimeout(player.removalTimeout);
    player.removalTimeout = null;
  }
  player.socketId = socket.id;
  player.connected = true;
  socket.join(code);
}

io.on('connection', (socket) => {
  let joinedCode = null;
  let playerId = null;

  socket.on('create-room', ({ name, token }, cb) => {
    if (!token) return cb?.({ error: 'token required' });
    const code = makeRoomCode();
    playerId = token;
    const player = { id: playerId, name: (name || 'Player').slice(0, 20), socketId: socket.id, connected: true };
    const room = { code, hostId: playerId, players: [player], game: null };
    rooms.set(code, room);
    socket.join(code);
    joinedCode = code;
    cb?.({ ok: true, code, playerId });
    broadcastRoom(code);
  });

  socket.on('join-room', ({ code, name, token }, cb) => {
    if (!token) return cb?.({ error: 'token required' });
    code = (code || '').toUpperCase();
    const room = getRoom(code);
    if (!room) return cb?.({ error: 'room not found' });

    const existing = room.players.find(p => p.id === token);
    if (existing) {
      playerId = token;
      joinedCode = code;
      attachSocketToPlayer(existing, socket, code);
      cb?.({ ok: true, code, playerId, rejoined: true });
      broadcastRoom(code);
      return;
    }

    if (room.game) return cb?.({ error: 'game already started' });
    if (room.players.length >= 8) return cb?.({ error: 'room full' });
    playerId = token;
    const player = { id: playerId, name: (name || 'Player').slice(0, 20), socketId: socket.id, connected: true };
    room.players.push(player);
    socket.join(code);
    joinedCode = code;
    cb?.({ ok: true, code, playerId });
    broadcastRoom(code);
  });

  socket.on('rejoin', ({ code, token }, cb) => {
    if (!token) return cb?.({ error: 'token required' });
    code = (code || '').toUpperCase();
    const room = getRoom(code);
    if (!room) return cb?.({ error: 'room not found' });
    const existing = room.players.find(p => p.id === token);
    if (!existing) return cb?.({ error: 'not in room' });
    playerId = token;
    joinedCode = code;
    attachSocketToPlayer(existing, socket, code);
    cb?.({ ok: true, code, playerId, started: !!room.game });
    broadcastRoom(code);
  });

  socket.on('start-game', (_, cb) => {
    const room = getRoom(joinedCode);
    if (!room) return cb?.({ error: 'no room' });
    if (room.hostId !== playerId) return cb?.({ error: 'only host can start' });
    if (room.players.length < 2) return cb?.({ error: 'need at least 2 players' });
    if (room.game) return cb?.({ error: 'already started' });
    room.game = createGame(room.players.map(p => ({ id: p.id, name: p.name })));
    cb?.({ ok: true });
    broadcastRoom(joinedCode);
    armTurnTimer(joinedCode);
  });

  socket.on('play-card', ({ cardId, chosenColor }, cb) => {
    const room = getRoom(joinedCode);
    if (!room?.game) return cb?.({ error: 'no game' });
    const result = playCard(room.game, playerId, cardId, chosenColor);
    cb?.(result);
    if (room.game.winnerId) {
      clearTurnTimer(room);
      clearUnoPenalty(room);
    } else {
      armTurnTimer(joinedCode);
      if (result.ok) {
        const hand = room.game.hands[playerId];
        if (hand && hand.length === 1 && !room.game.unoCalls[playerId]) {
          armUnoPenalty(joinedCode, playerId);
        } else if (room.unoPenaltyFor === playerId) {
          clearUnoPenalty(room);
        }
      }
    }
    broadcastRoom(joinedCode);
  });

  socket.on('draw-card', (_, cb) => {
    const room = getRoom(joinedCode);
    if (!room?.game) return cb?.({ error: 'no game' });
    const result = drawTurn(room.game, playerId);
    cb?.(result);
    if (room.game.winnerId) {
      clearTurnTimer(room);
      clearUnoPenalty(room);
    } else {
      armTurnTimer(joinedCode);
      if (room.unoPenaltyFor === playerId) clearUnoPenalty(room);
    }
    broadcastRoom(joinedCode);
  });

  socket.on('skip-turn', (_, cb) => {
    const room = getRoom(joinedCode);
    if (!room?.game) return cb?.({ error: 'no game' });
    const result = skipTurn(room.game, playerId);
    cb?.(result);
    if (room.game.winnerId) {
      clearTurnTimer(room);
      clearUnoPenalty(room);
    } else if (result.ok) {
      armTurnTimer(joinedCode);
    }
    broadcastRoom(joinedCode);
  });

  socket.on('call-uno', (_, cb) => {
    const room = getRoom(joinedCode);
    if (!room?.game) return cb?.({ error: 'no game' });
    const result = callUno(room.game, playerId);
    cb?.(result);
    if (result.ok && room.unoPenaltyFor === playerId) clearUnoPenalty(room);
    broadcastRoom(joinedCode);
  });

  socket.on('new-game', (_, cb) => {
    const room = getRoom(joinedCode);
    if (!room) return cb?.({ error: 'no room' });
    if (room.hostId !== playerId) return cb?.({ error: 'only host' });
    if (!room.game?.winnerId) return cb?.({ error: 'current game not over' });
    clearTurnTimer(room);
    clearUnoPenalty(room);
    room.game = createGame(room.players.map(p => ({ id: p.id, name: p.name })));
    cb?.({ ok: true });
    broadcastRoom(joinedCode);
    armTurnTimer(joinedCode);
  });

  socket.on('leave-room', (_, cb) => {
    if (!joinedCode || !playerId) return cb?.({ ok: true });
    const code = joinedCode;
    const pid = playerId;
    const room = getRoom(code);
    joinedCode = null;
    playerId = null;
    if (!room) return cb?.({ ok: true });

    if (!room.game || room.game.winnerId) {
      removePlayer(code, pid);
      return cb?.({ ok: true });
    }

    const wasCurrent = currentPlayer(room.game)?.id === pid;
    const leaverName = room.players.find(p => p.id === pid)?.name || 'A player';
    removeFromGame(room.game, pid);
    room.players = room.players.filter(p => p.id !== pid);
    if (room.hostId === pid && room.players.length > 0) {
      room.hostId = (room.players.find(p => p.connected) || room.players[0]).id;
    }

    if (room.players.length === 0) {
      clearTurnTimer(room);
      rooms.delete(code);
      return cb?.({ ok: true });
    }

    if (room.players.length < 2) {
      clearTurnTimer(room);
      clearUnoPenalty(room);
      room.game = null;
      io.to(code).emit('notice', { message: `${leaverName} left. Game ended.` });
      broadcastRoom(code);
      return cb?.({ ok: true });
    }

    if (wasCurrent) clearTurnTimer(room);
    if (room.unoPenaltyFor === pid) clearUnoPenalty(room);
    io.to(code).emit('notice', { message: `${leaverName} left the game.` });
    broadcastRoom(code);
    armTurnTimer(code);
    cb?.({ ok: true });
  });

  socket.on('disconnect', () => {
    const room = getRoom(joinedCode);
    if (!room) return;
    const player = room.players.find(p => p.id === playerId);
    if (!player) return;
    if (player.socketId !== socket.id) return;
    player.connected = false;
    player.socketId = null;

    if (!room.game) {
      const code = joinedCode;
      const pid = playerId;
      player.removalTimeout = setTimeout(() => {
        const r = getRoom(code);
        if (!r) return;
        const p = r.players.find(x => x.id === pid);
        if (p && !p.connected) removePlayer(code, pid);
      }, PRE_GAME_GRACE_MS);
    }

    broadcastRoom(joinedCode);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`UNO server running on port ${PORT}`);
});
