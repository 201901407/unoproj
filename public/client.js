const socket = io({ reconnection: true, reconnectionDelay: 500, reconnectionDelayMax: 3000 });

const $ = (id) => document.getElementById(id);
const screens = { home: $('home'), lobby: $('lobby'), game: $('game') };
const show = (name) => {
  for (const key of Object.keys(screens)) screens[key].classList.toggle('hidden', key !== name);
};

const TOKEN_KEY = 'uno:token';
const SESSION_KEY = 'uno:session';

function getToken() {
  let t = localStorage.getItem(TOKEN_KEY);
  if (!t) {
    t = (crypto.randomUUID && crypto.randomUUID()) ||
      ([1e7] + -1e3 + -4e3 + -8e3 + -1e11).replace(/[018]/g, c =>
        (c ^ (crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> c / 4)).toString(16));
    localStorage.setItem(TOKEN_KEY, t);
  }
  return t;
}

function saveSession(code) { localStorage.setItem(SESSION_KEY, JSON.stringify({ code })); }
function loadSession() { try { return JSON.parse(localStorage.getItem(SESSION_KEY) || 'null'); } catch { return null; } }
function clearSession() { localStorage.removeItem(SESSION_KEY); }

const token = getToken();

let myId = null;
let roomCode = null;
let hostId = null;
let pendingCardId = null;
let lastState = null;
let rejoinAttempted = false;

$('create-btn').addEventListener('click', () => {
  const name = $('name-input').value.trim() || 'Player';
  socket.emit('create-room', { name, token }, (res) => {
    if (res?.error) return showHomeError(res.error);
    myId = res.playerId;
    roomCode = res.code;
    saveSession(roomCode);
    show('lobby');
  });
});

$('join-btn').addEventListener('click', () => {
  const name = $('name-input').value.trim() || 'Player';
  const code = $('code-input').value.trim().toUpperCase();
  if (!code) return showHomeError('enter a room code');
  socket.emit('join-room', { name, code, token }, (res) => {
    if (res?.error) return showHomeError(res.error);
    myId = res.playerId;
    roomCode = res.code;
    saveSession(roomCode);
    show('lobby');
  });
});

$('start-btn').addEventListener('click', () => {
  socket.emit('start-game', {}, (res) => {
    if (res?.error) alert(res.error);
  });
});

$('draw-btn').addEventListener('click', () => {
  socket.emit('draw-card', {}, (res) => {
    if (res?.error) flash(res.error);
  });
});

$('skip-btn').addEventListener('click', () => {
  socket.emit('skip-turn', {}, (res) => {
    if (res?.error) flash(res.error);
  });
});

$('uno-btn').addEventListener('click', () => {
  socket.emit('call-uno', {}, (res) => {
    if (res?.error) flash(res.error);
    else flash('UNO!');
  });
});

$('leave-btn').addEventListener('click', () => {
  socket.emit('leave-room', {}, () => {
    clearSession();
    myId = null;
    roomCode = null;
    hostId = null;
    show('home');
  });
});

document.querySelectorAll('.color-swatch').forEach(btn => {
  btn.addEventListener('click', () => {
    const color = btn.dataset.color;
    $('color-picker').classList.add('hidden');
    if (!pendingCardId) return;
    const cardId = pendingCardId;
    pendingCardId = null;
    socket.emit('play-card', { cardId, chosenColor: color }, (res) => {
      if (res?.error) flash(res.error);
    });
  });
});

function showHomeError(msg) {
  $('home-error').textContent = msg;
  setTimeout(() => { $('home-error').textContent = ''; }, 3000);
}

function flash(msg) {
  const s = $('status');
  const prev = s.textContent;
  s.textContent = msg;
  setTimeout(() => { if (s.textContent === msg) s.textContent = prev; }, 1500);
}

function setConnBanner(msg) {
  const b = $('conn-banner');
  if (!b) return;
  if (!msg) { b.classList.add('hidden'); b.textContent = ''; }
  else { b.classList.remove('hidden'); b.textContent = msg; }
}

socket.on('connect', () => {
  setConnBanner(null);
  const session = loadSession();
  if (!session?.code) return;
  socket.emit('rejoin', { code: session.code, token }, (res) => {
    rejoinAttempted = true;
    if (res?.error) {
      clearSession();
      myId = null;
      roomCode = null;
      show('home');
      if (res.error !== 'room not found' && res.error !== 'not in room') {
        showHomeError(res.error);
      }
      return;
    }
    myId = res.playerId;
    roomCode = res.code;
  });
});

socket.on('disconnect', () => {
  if (loadSession()?.code) setConnBanner('Reconnecting…');
});

socket.io.on('reconnect_attempt', () => {
  if (loadSession()?.code) setConnBanner('Reconnecting…');
});

socket.on('lobby', (lobby) => {
  roomCode = lobby.code;
  hostId = lobby.hostId;
  $('room-code').textContent = lobby.code;
  const list = $('player-list');
  list.innerHTML = '';
  for (const p of lobby.players) {
    const li = document.createElement('li');
    li.textContent = p.name + (p.connected ? '' : ' (disconnected)');
    if (p.id === lobby.hostId) li.classList.add('host');
    if (p.id === myId) li.classList.add('you');
    list.appendChild(li);
  }
  const isHost = myId === lobby.hostId;
  $('start-btn').classList.toggle('hidden', !isHost || lobby.started);
  $('start-btn').disabled = lobby.players.length < 2;
  $('lobby-wait').classList.toggle('hidden', isHost || lobby.started);

  if (lobby.started) {
    show('game');
  } else {
    lastState = null;
    show('lobby');
  }
});

socket.on('notice', ({ message }) => {
  const n = $('notice');
  if (!n) return;
  n.textContent = message;
  n.classList.remove('hidden');
  clearTimeout(window.__noticeTimer);
  window.__noticeTimer = setTimeout(() => n.classList.add('hidden'), 4000);
});

socket.on('state', (state) => {
  lastState = state;
  show('game');
  renderGame(state);
});

socket.on('kicked', ({ reason }) => {
  clearSession();
  myId = null;
  roomCode = null;
  hostId = null;
  lastState = null;
  show('home');
  showHomeError(reason === 'inactive' ? 'Dropped for inactivity' : `Removed: ${reason}`);
});

setInterval(() => {
  if (!lastState?.turnDeadline) return;
  if (screens.game.classList.contains('hidden')) return;
  updateTurnCountdown(lastState);
}, 500);

function cardGlyph(card) {
  if (card.value === 'wild4') return '+4';
  if (card.value === 'wild') return 'W';
  if (card.value === 'draw2') return '+2';
  if (card.value === 'skip') return 'Ø';
  if (card.value === 'reverse') return '⇄';
  return card.value;
}

function renderCard(card, { small, playable, displayColor } = {}) {
  const el = document.createElement('div');
  el.className = 'card ' + (displayColor || card.color);
  if (small) el.classList.add('small');
  if (playable) el.classList.add('playable');
  el.dataset.cardId = card.id;
  const g = cardGlyph(card);
  if (small) {
    el.innerHTML = `<div class="oval"><span class="glyph">${g}</span></div>`;
  } else {
    el.innerHTML = `
      <span class="corner tl">${g}</span>
      <div class="oval"><span class="glyph">${g}</span></div>
      <span class="corner br">${g}</span>
    `;
  }
  return el;
}

function canPlayClient(state, card) {
  if (state.drawStack > 0) return card.value === 'draw2' || card.value === 'wild4';
  if (card.color === 'wild') return true;
  return card.color === state.currentColor || card.value === state.currentValue;
}

function seatPosition(stepsAhead, total) {
  const angleDeg = 180 + (stepsAhead / total) * 180;
  const rad = (angleDeg * Math.PI) / 180;
  const radius = 46;
  return {
    left: `${50 + radius * Math.cos(rad)}%`,
    top: `${50 + radius * Math.sin(rad)}%`,
  };
}

function turnStepsAhead(myIndex, playerIndex, total, direction) {
  if (direction === 1) return (playerIndex - myIndex + total) % total;
  return (myIndex - playerIndex + total) % total;
}

function buildSeatEl(player, { isYou, isTurn, connected }) {
  const d = document.createElement('div');
  d.className = 'opponent';
  if (isYou) d.classList.add('you');
  if (isTurn) d.classList.add('turn');
  if (connected === false) d.classList.add('disconnected');
  d.innerHTML = `
    ${isYou ? '<div class="you-label">YOU</div>' : ''}
    ${isTurn ? '<div class="turn-badge">TURN</div>' : ''}
    <div class="name">${escapeHtml(player.name)}</div>
    <div class="opp-cards">
      <div class="card small back"><div class="oval"><span class="glyph">UNO</span></div></div>
      <div class="count">×${player.handCount}</div>
    </div>
  `;
  return d;
}

function renderGame(state) {
  const ring = $('table-ring');
  ring.querySelectorAll('.seat:not(#self-seat)').forEach(el => el.remove());

  const myIndex = state.players.findIndex(p => p.id === myId);
  const n = state.players.length;
  const dir = state.direction ?? 1;

  $('direction-indicator').textContent = dir === 1 ? '↻' : '↺';
  $('direction-indicator').title = dir === 1 ? 'Turns go clockwise' : 'Turns go counter-clockwise';

  for (const p of state.players) {
    if (p.id === myId) continue;
    const pIndex = state.players.findIndex(x => x.id === p.id);
    const steps = turnStepsAhead(myIndex, pIndex, n, dir);
    const pos = seatPosition(steps, n);
    const seat = document.createElement('div');
    seat.className = 'seat';
    seat.style.left = pos.left;
    seat.style.top = pos.top;
    seat.appendChild(buildSeatEl(p, {
      isYou: false,
      isTurn: p.id === state.turnPlayerId,
      connected: p.connected,
    }));
    ring.appendChild(seat);
  }

  const selfSeat = $('self-seat');
  selfSeat.innerHTML = '';
  const me = state.players.find(p => p.id === myId);
  if (me) {
    selfSeat.appendChild(buildSeatEl(me, {
      isYou: true,
      isTurn: state.turnPlayerId === myId,
      connected: true,
    }));
  }

  const topCard = state.topCard;
  const topEl = $('top-card');
  const topDisplayColor = topCard.color === 'wild' ? state.currentColor : topCard.color;
  const topGlyph = cardGlyph(topCard);
  topEl.className = 'card ' + topDisplayColor;
  topEl.innerHTML = `
    <span class="corner tl">${topGlyph}</span>
    <div class="oval"><span class="glyph">${topGlyph}</span></div>
    <span class="corner br">${topGlyph}</span>
  `;

  $('deck-count').textContent = `${state.deckCount} in deck`;

  const myTurn = state.turnPlayerId === myId;
  const turnPlayer = state.players.find(p => p.id === state.turnPlayerId);
  const turnSummaryTitle = myTurn ? 'Your turn' : `${turnPlayer?.name || '...'} to play`;

  $('turn-summary-title').textContent = turnSummaryTitle;

  let status = myTurn ? 'Your turn' : `${turnPlayer?.name || '...'}'s turn`;
  if (state.drawStack > 0) status = `Draw ${state.drawStack} before playing`;
  else if (state.canSkipTurn) status = 'Play your drawn card or pass';
  else if (state.currentColor !== topCard.color && topCard.color === 'wild') {
    status = `Color is ${state.currentColor}`;
  }
  $('status').textContent = status;
  updateTurnCountdown(state);

  const hand = $('hand');
  hand.innerHTML = '';
  for (const card of state.hand) {
    const playable = myTurn && !state.winnerId && canPlayClient(state, card);
    const el = renderCard(card, { playable });
    el.classList.add('in-hand');
    if (playable) {
      el.addEventListener('click', () => onPlayCard(card));
    }
    hand.appendChild(el);
  }

  const canDraw = myTurn && !state.winnerId && !state.canSkipTurn;
  $('draw-btn').disabled = !canDraw;
  $('skip-btn').classList.toggle('hidden', !state.canSkipTurn || !!state.winnerId);
  $('skip-btn').disabled = !state.canSkipTurn || !!state.winnerId;
  $('uno-btn').disabled = !(state.hand.length === 1 && !state.winnerId);
  $('uno-btn').classList.toggle('urgent', state.unoPenaltyFor === myId && !state.winnerId);

  const banner = $('banner');
  if (state.winnerId) {
    const winner = state.players.find(p => p.id === state.winnerId);
    const isHost = myId === hostId;
    banner.classList.remove('hidden');
    const title = `<div class="banner-title">${escapeHtml(winner?.name || 'Someone')} wins!</div>`;
    const actions = isHost
      ? '<div class="banner-actions"><button id="banner-new-game">New game</button><button id="banner-leave" class="secondary">Leave</button></div>'
      : '<div class="banner-sub">Waiting for host to start a new game…</div><div class="banner-actions"><button id="banner-leave" class="secondary">Leave</button></div>';
    banner.innerHTML = title + actions;
    const ng = banner.querySelector('#banner-new-game');
    if (ng) ng.onclick = () => {
      socket.emit('new-game', {}, (res) => { if (res?.error) alert(res.error); });
    };
    banner.querySelector('#banner-leave').onclick = () => $('leave-btn').click();
  } else {
    banner.classList.add('hidden');
    banner.innerHTML = '';
  }

  const deckActive = canDraw;
  $('deck').classList.toggle('active', deckActive);
  $('deck').onclick = deckActive ? () => $('draw-btn').click() : null;
}

function updateTurnCountdown(state) {
  const el = $('turn-timer');
  if (!el) return;
  if (!state?.turnDeadline || state.winnerId) {
    el.textContent = '';
    el.classList.add('hidden');
    return;
  }
  const remaining = Math.max(0, Math.ceil((state.turnDeadline - Date.now()) / 1000));
  el.classList.remove('hidden');
  el.textContent = `${remaining}s`;
  el.classList.toggle('urgent', remaining <= 10);
}

function onPlayCard(card) {
  if (card.color === 'wild') {
    pendingCardId = card.id;
    $('color-picker').classList.remove('hidden');
    return;
  }
  socket.emit('play-card', { cardId: card.id, chosenColor: null }, (res) => {
    if (res?.error) flash(res.error);
  });
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

$('code-input').addEventListener('input', (e) => {
  e.target.value = e.target.value.toUpperCase();
});
