const COLORS = ['red', 'yellow', 'green', 'blue'];
const VALUES = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', 'skip', 'reverse', 'draw2'];

let cardIdCounter = 0;
const newId = () => `c${++cardIdCounter}`;

export function buildDeck() {
  const deck = [];
  for (const color of COLORS) {
    deck.push({ id: newId(), color, value: '0' });
    for (const v of VALUES.slice(1)) {
      deck.push({ id: newId(), color, value: v });
      deck.push({ id: newId(), color, value: v });
    }
  }
  for (let i = 0; i < 4; i++) {
    deck.push({ id: newId(), color: 'wild', value: 'wild' });
    deck.push({ id: newId(), color: 'wild', value: 'wild4' });
  }
  return shuffle(deck);
}

export function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function createGame(players) {
  const deck = buildDeck();
  const hands = {};
  for (const p of players) {
    hands[p.id] = deck.splice(0, 7);
  }
  let top;
  do {
    top = deck.shift();
    if (top.color === 'wild') deck.push(top);
  } while (top.color === 'wild');

  return {
    players,
    hands,
    deck,
    discard: [top],
    currentColor: top.color,
    currentValue: top.value,
    turnIndex: 0,
    direction: 1,
    drawStack: 0,
    winnerId: null,
    lastAction: null,
    unoCalls: {},
    drewThisTurn: null,
  };
}

export function currentPlayer(state) {
  return state.players[state.turnIndex];
}

export function canPlay(state, card) {
  if (state.drawStack > 0) {
    return card.value === 'draw2' || card.value === 'wild4';
  }
  if (card.color === 'wild') return true;
  return card.color === state.currentColor || card.value === state.currentValue;
}

function advance(state, steps = 1) {
  const n = state.players.length;
  state.turnIndex = (state.turnIndex + steps * state.direction + n * steps) % n;
  state.drewThisTurn = null;
}

function reshuffleIfNeeded(state) {
  if (state.deck.length > 0) return;
  const top = state.discard.pop();
  state.deck = shuffle(state.discard.map(c => {
    if (c.value === 'wild' || c.value === 'wild4') return { ...c, color: 'wild' };
    return c;
  }));
  state.discard = [top];
}

export function drawCards(state, playerId, count) {
  const drawn = [];
  for (let i = 0; i < count; i++) {
    reshuffleIfNeeded(state);
    if (state.deck.length === 0) break;
    const card = state.deck.shift();
    state.hands[playerId].push(card);
    drawn.push(card);
  }
  if (drawn.length > 0) delete state.unoCalls[playerId];
  return drawn;
}

export function playCard(state, playerId, cardId, chosenColor) {
  if (state.winnerId) return { error: 'game over' };
  const player = currentPlayer(state);
  if (player.id !== playerId) return { error: 'not your turn' };

  const hand = state.hands[playerId];
  const idx = hand.findIndex(c => c.id === cardId);
  if (idx === -1) return { error: 'card not in hand' };

  const card = hand[idx];
  if (!canPlay(state, card)) return { error: 'illegal move' };

  hand.splice(idx, 1);
  state.discard.push(card);

  if (card.color === 'wild') {
    if (!COLORS.includes(chosenColor)) return { error: 'must choose a color' };
    state.currentColor = chosenColor;
    state.currentValue = card.value;
  } else {
    state.currentColor = card.color;
    state.currentValue = card.value;
  }

  state.lastAction = { type: 'play', playerId, card, chosenColor: chosenColor || null };
  state.drewThisTurn = null;

  if (hand.length === 0) {
    state.winnerId = playerId;
    return { ok: true };
  }

  if (hand.length !== 1) {
    delete state.unoCalls[playerId];
  }

  if (card.value === 'skip') {
    advance(state, 1);
    advance(state, 1);
  } else if (card.value === 'reverse') {
    state.direction *= -1;
    if (state.players.length === 2) advance(state, 2);
    else advance(state, 1);
  } else if (card.value === 'draw2') {
    state.drawStack += 2;
    advance(state, 1);
  } else if (card.value === 'wild4') {
    state.drawStack += 4;
    advance(state, 1);
  } else {
    advance(state, 1);
  }

  return { ok: true };
}

export function drawTurn(state, playerId) {
  if (state.winnerId) return { error: 'game over' };
  const player = currentPlayer(state);
  if (player.id !== playerId) return { error: 'not your turn' };
  if (state.drewThisTurn === playerId) return { error: 'already drew — play or pass' };

  if (state.drawStack > 0) {
    const drawn = drawCards(state, playerId, state.drawStack);
    state.drawStack = 0;
    state.lastAction = { type: 'forced-draw', playerId, count: drawn.length };
    advance(state, 1);
    return { ok: true, drawn };
  }

  const drawn = drawCards(state, playerId, 1);
  state.lastAction = { type: 'draw', playerId, count: 1 };
  const card = drawn[0];
  if (card && canPlay(state, card)) {
    state.drewThisTurn = playerId;
    return { ok: true, drawn, playable: true };
  }
  advance(state, 1);
  return { ok: true, drawn, playable: false };
}

export function skipTurn(state, playerId) {
  if (state.winnerId) return { error: 'game over' };
  const player = currentPlayer(state);
  if (player.id !== playerId) return { error: 'not your turn' };
  if (state.drewThisTurn !== playerId) return { error: 'can only pass after drawing' };

  state.lastAction = { type: 'pass', playerId };
  advance(state, 1);
  return { ok: true };
}

export function callUno(state, playerId) {
  if (state.hands[playerId]?.length === 1) {
    state.unoCalls[playerId] = true;
    return { ok: true };
  }
  return { error: 'cannot call uno now' };
}

export function removeFromGame(state, playerId) {
  const idx = state.players.findIndex(p => p.id === playerId);
  if (idx === -1) return { error: 'not in game' };

  const wasCurrent = idx === state.turnIndex;
  let nextPlayerId = null;
  if (wasCurrent && state.players.length > 2) {
    const n = state.players.length;
    const nextIdx = (state.turnIndex + state.direction + n) % n;
    nextPlayerId = state.players[nextIdx].id;
  }

  const hand = state.hands[playerId] || [];
  const reclaimed = hand.map(c =>
    (c.value === 'wild' || c.value === 'wild4') ? { ...c, color: 'wild' } : c
  );
  state.deck = shuffle([...state.deck, ...reclaimed]);
  delete state.hands[playerId];
  delete state.unoCalls[playerId];
  if (state.drewThisTurn === playerId) state.drewThisTurn = null;
  state.players.splice(idx, 1);
  state.lastAction = { type: 'drop', playerId };

  if (state.players.length === 0) {
    state.winnerId = null;
    state.drawStack = 0;
    state.turnIndex = 0;
    return { ok: true, gameOver: true };
  }
  if (state.players.length === 1) {
    state.winnerId = state.players[0].id;
    state.drawStack = 0;
    state.turnIndex = 0;
    return { ok: true, gameOver: true };
  }

  if (wasCurrent) {
    state.drawStack = 0;
    state.turnIndex = nextPlayerId
      ? state.players.findIndex(p => p.id === nextPlayerId)
      : state.turnIndex % state.players.length;
  } else if (idx < state.turnIndex) {
    state.turnIndex -= 1;
  }

  return { ok: true, gameOver: false };
}

export function publicState(state, viewerId) {
  const cur = currentPlayer(state);
  return {
    players: state.players.map(p => ({
      id: p.id,
      name: p.name,
      handCount: (state.hands[p.id] || []).length,
    })),
    hand: state.hands[viewerId] || [],
    topCard: state.discard[state.discard.length - 1],
    currentColor: state.currentColor,
    currentValue: state.currentValue,
    turnPlayerId: cur?.id || null,
    direction: state.direction,
    drawStack: state.drawStack,
    deckCount: state.deck.length,
    winnerId: state.winnerId,
    lastAction: state.lastAction,
    canSkipTurn: cur?.id === viewerId && state.drewThisTurn === viewerId,
  };
}
