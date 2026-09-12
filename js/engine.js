// Pure Texas Hold'em engine. No DOM, no randomness of its own — an RNG is injected.
// The same module runs the browser game and could run server-side unchanged.

export const SUITS = ['S', 'H', 'D', 'C'];
export const RANK_NAMES = { 2: '2', 3: '3', 4: '4', 5: '5', 6: '6', 7: '7', 8: '8', 9: '9', 10: '10', 11: 'J', 12: 'Q', 13: 'K', 14: 'A' };

export function mulberry32(seed) {
  let a = seed >>> 0;
  const next = function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  // Readable and restorable, so a tournament can be picked up where it was left.
  next.getState = () => a >>> 0;
  next.setState = (v) => { a = v >>> 0; };
  return next;
}

export function makeDeck() {
  const d = [];
  for (const s of SUITS) for (let r = 2; r <= 14; r++) d.push(r * 4 + SUITS.indexOf(s));
  return d;
}
export const cardRank = (c) => Math.floor(c / 4);
export const cardSuit = (c) => SUITS[c % 4];
export const cardCode = (c) => RANK_NAMES[cardRank(c)] + cardSuit(c);

export function shuffle(deck, rng) {
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

/* ---------- hand evaluation ---------- */

const CAT = ['High Card', 'Pair', 'Two Pair', 'Three of a Kind', 'Straight', 'Flush', 'Full House', 'Four of a Kind', 'Straight Flush'];

// Score a 5-card hand as a single comparable integer.
function eval5(c0, c1, c2, c3, c4) {
  const rs = [cardRank(c0), cardRank(c1), cardRank(c2), cardRank(c3), cardRank(c4)];
  const ss = [c0 % 4, c1 % 4, c2 % 4, c3 % 4, c4 % 4];
  const flush = ss[0] === ss[1] && ss[1] === ss[2] && ss[2] === ss[3] && ss[3] === ss[4];

  const counts = new Map();
  for (const r of rs) counts.set(r, (counts.get(r) || 0) + 1);
  // sort by count desc, then rank desc
  const groups = [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0]);

  const sorted = [...rs].sort((a, b) => b - a);
  let straightHigh = 0;
  if (counts.size === 5) {
    if (sorted[0] - sorted[4] === 4) straightHigh = sorted[0];
    else if (sorted[0] === 14 && sorted[1] === 5 && sorted[4] === 2) straightHigh = 5; // wheel
  }

  let cat, kick;
  if (straightHigh && flush) { cat = 8; kick = [straightHigh]; }
  else if (groups[0][1] === 4) { cat = 7; kick = [groups[0][0], groups[1][0]]; }
  else if (groups[0][1] === 3 && groups[1][1] === 2) { cat = 6; kick = [groups[0][0], groups[1][0]]; }
  else if (flush) { cat = 5; kick = sorted; }
  else if (straightHigh) { cat = 4; kick = [straightHigh]; }
  else if (groups[0][1] === 3) { cat = 3; kick = [groups[0][0], groups[1][0], groups[2][0]]; }
  else if (groups[0][1] === 2 && groups[1][1] === 2) { cat = 2; kick = [groups[0][0], groups[1][0], groups[2][0]]; }
  else if (groups[0][1] === 2) { cat = 1; kick = [groups[0][0], groups[1][0], groups[2][0], groups[3][0]]; }
  else { cat = 0; kick = sorted; }

  let score = cat;
  for (let i = 0; i < 5; i++) score = score * 15 + (kick[i] || 0);
  return score;
}

// Choose-5 index tables for 5, 6 and 7 available cards. The board is only three
// cards on the flop, so the 7-card table alone would index past the end.
const COMBOS = {};
for (let n = 5; n <= 7; n++) {
  const list = [];
  for (let a = 0; a <= n - 5; a++)
    for (let b = a + 1; b <= n - 4; b++)
      for (let c = b + 1; c <= n - 3; c++)
        for (let d = c + 1; d <= n - 2; d++)
          for (let e = d + 1; e <= n - 1; e++) list.push([a, b, c, d, e]);
  COMBOS[n] = list;
}

// Best five-card score from any 5, 6 or 7 cards.
export function evaluate7(cards) {
  const table = COMBOS[cards.length];
  if (!table) throw new Error('need 5 to 7 cards, got ' + cards.length);
  let best = -1;
  for (const [a, b, c, d, e] of table) {
    const s = eval5(cards[a], cards[b], cards[c], cards[d], cards[e]);
    if (s > best) best = s;
  }
  return best;
}

export const HAND_CATEGORIES = CAT;

// Win equity plus the chance of finishing with each category by the river.
export function handOdds(hole, board, opponents, iterations, rng) {
  const known = new Set([...hole, ...board]);
  const base = makeDeck().filter(c => !known.has(c));
  const need = 5 - board.length;
  const cats = new Array(CAT.length).fill(0);
  let win = 0, tie = 0;

  for (let it = 0; it < iterations; it++) {
    const pool = base.slice();
    const drawn = [];
    const total = need + opponents * 2;
    for (let i = 0; i < total; i++) {
      const j = i + Math.floor(rng() * (pool.length - i));
      [pool[i], pool[j]] = [pool[j], pool[i]];
      drawn.push(pool[i]);
    }
    const full = board.concat(drawn.slice(0, need));
    const mine = evaluate7([...hole, ...full]);
    cats[Math.floor(mine / (15 ** 5))]++;
    let best = -1;
    for (let o = 0; o < opponents; o++) {
      const s = evaluate7([drawn[need + o * 2], drawn[need + o * 2 + 1], ...full]);
      if (s > best) best = s;
    }
    if (mine > best) win++; else if (mine === best) tie++;
  }
  return {
    win: (win + tie / 2) / iterations,
    categories: cats.map((n, i) => ({ name: CAT[i], p: n / iterations })),
  };
}

// The exact five cards that make the best hand, for showing at a showdown.
export function bestFive(cards) {
  const table = COMBOS[cards.length];
  let best = -1, pick = null;
  for (const combo of table) {
    const sc = eval5(cards[combo[0]], cards[combo[1]], cards[combo[2]], cards[combo[3]], cards[combo[4]]);
    if (sc > best) { best = sc; pick = combo; }
  }
  return pick.map(i => cards[i]);
}

export function handName(score) {
  const cat = Math.floor(score / (15 ** 5));
  return CAT[cat];
}

/* ---------- side pots ---------- */

export function buildPots(players) {
  const levels = [...new Set(players.filter(p => p.committed > 0).map(p => p.committed))].sort((a, b) => a - b);
  const pots = [];
  let prev = 0;
  for (const level of levels) {
    let amount = 0;
    const eligible = [];
    for (const p of players) {
      amount += Math.min(p.committed, level) - Math.min(p.committed, prev);
      if (p.committed >= level && !p.folded) eligible.push(p.id);
    }
    if (amount > 0) pots.push({ amount, eligible });
    prev = level;
  }
  return pots;
}

/* ---------- table state machine ---------- */

export const STREETS = ['preflop', 'flop', 'turn', 'river', 'showdown'];

export class Table {
  constructor({ players, smallBlind, bigBlind, rng, buttonIndex = 0 }) {
    this.players = players.map((p, i) => ({
      id: p.id, name: p.name, chips: p.chips, seat: i,
      hole: [], bet: 0, committed: 0, folded: false, allIn: false, acted: false, out: p.chips <= 0,
    }));
    this.smallBlind = smallBlind;
    this.bigBlind = bigBlind;
    this.rng = rng;
    this.button = buttonIndex;
    this.board = [];
    this.street = 'preflop';
    this.log = [];
  }

  livePlayers() { return this.players.filter(p => !p.out); }
  inHand() { return this.players.filter(p => !p.folded && !p.out); }
  canAct() { return this.players.filter(p => !p.folded && !p.allIn && !p.out); }

  nextOccupied(from) {
    const n = this.players.length;
    for (let i = 1; i <= n; i++) {
      const idx = (from + i) % n;
      if (!this.players[idx].out) return idx;
    }
    return from;
  }

  startHand() {
    const live = this.livePlayers();
    if (live.length < 2) return false;

    this.deck = shuffle(makeDeck(), this.rng);
    this.board = [];
    this.street = 'preflop';
    this.pot = 0;
    this.currentBet = 0;
    this.lastRaiseSize = this.bigBlind;
    this.log = [];
    this.aggressor = null;   // last player to bet or raise, carried across streets
    this.handOver = false;
    this.results = null;

    for (const p of this.players) {
      p.hole = []; p.bet = 0; p.committed = 0;
      p.folded = p.out; p.allIn = false; p.acted = false;
    }

    // deal
    for (let round = 0; round < 2; round++)
      for (const p of live) p.hole.push(this.deck.pop());

    // blinds: heads-up puts the button on the small blind
    const sbIdx = live.length === 2 ? this.button : this.nextOccupied(this.button);
    const bbIdx = this.nextOccupied(sbIdx);
    this.postBlind(sbIdx, this.smallBlind);
    this.postBlind(bbIdx, this.bigBlind);
    this.currentBet = this.bigBlind;
    this.bbIndex = bbIdx;

    this.turn = this.nextOccupied(bbIdx);
    // skip anyone already all-in from a blind
    if (this.players[this.turn].allIn) this.turn = this.findNextToAct(this.turn);
    return true;
  }

  postBlind(idx, amount) {
    const p = this.players[idx];
    const pay = Math.min(amount, p.chips);
    p.chips -= pay; p.bet = pay; p.committed = pay; this.pot += pay;
    if (p.chips === 0) p.allIn = true;
  }

  findNextToAct(from) {
    const n = this.players.length;
    for (let i = 1; i <= n; i++) {
      const idx = (from + i) % n;
      const p = this.players[idx];
      if (!p.out && !p.folded && !p.allIn) return idx;
    }
    return -1;
  }

  legalActions(idx = this.turn) {
    const p = this.players[idx];
    const toCall = Math.max(0, this.currentBet - p.bet);
    const callAmount = Math.min(toCall, p.chips);
    const minRaiseTo = this.currentBet + this.lastRaiseSize;
    const maxRaiseTo = p.bet + p.chips;
    return {
      canCheck: toCall === 0,
      canCall: toCall > 0,
      callAmount,
      canRaise: p.chips > toCall,
      minRaiseTo: Math.min(minRaiseTo, maxRaiseTo),
      maxRaiseTo,
      toCall,
    };
  }

  act(action) {
    const idx = this.turn;
    const p = this.players[idx];
    const la = this.legalActions(idx);

    if (action.type === 'fold') {
      p.folded = true;
      this.log.push({ player: p.id, type: 'fold' });
    } else if (action.type === 'check') {
      if (!la.canCheck) throw new Error('cannot check');
      this.log.push({ player: p.id, type: 'check' });
    } else if (action.type === 'call') {
      const pay = la.callAmount;
      p.chips -= pay; p.bet += pay; p.committed += pay; this.pot += pay;
      if (p.chips === 0) p.allIn = true;
      this.log.push({ player: p.id, type: 'call', amount: pay, allIn: p.allIn });
    } else if (action.type === 'raise') {
      let target = Math.max(la.minRaiseTo, Math.min(action.to, la.maxRaiseTo));
      if (action.to >= la.maxRaiseTo) target = la.maxRaiseTo; // all-in shortfall allowed
      const pay = target - p.bet;
      p.chips -= pay; p.bet += pay; p.committed += pay; this.pot += pay;
      if (p.chips === 0) p.allIn = true;
      const raiseSize = target - this.currentBet;
      if (raiseSize >= this.lastRaiseSize) this.lastRaiseSize = raiseSize;
      this.aggressor = p.id;
      this.currentBet = Math.max(this.currentBet, target);
      for (const o of this.players) if (o !== p && !o.folded && !o.allIn && !o.out) o.acted = false;
      this.log.push({ player: p.id, type: 'raise', amount: target, allIn: p.allIn });
    }
    p.acted = true;
    this.afterAction();
  }

  afterAction() {
    if (this.inHand().length === 1) { this.finish(); return; }
    if (this.roundComplete()) { this.advanceStreet(); return; }
    const next = this.findNextToAct(this.turn);
    if (next === -1) { this.advanceStreet(); return; }
    this.turn = next;
  }

  roundComplete() {
    const actors = this.canAct();
    if (actors.length === 0) return true;
    if (actors.length === 1 && this.inHand().length - 1 === this.players.filter(p => p.allIn && !p.folded).length) {
      // one player left who can act, everyone else all-in: they still owe a call
      const p = actors[0];
      if (p.acted && p.bet >= this.currentBet) return true;
    }
    return actors.every(p => p.acted && p.bet === this.currentBet);
  }

  advanceStreet() {
    for (const p of this.players) { p.bet = 0; p.acted = false; }
    this.currentBet = 0;
    this.lastRaiseSize = this.bigBlind;

    if (this.street === 'preflop') { this.board.push(this.deck.pop(), this.deck.pop(), this.deck.pop()); this.street = 'flop'; }
    else if (this.street === 'flop') { this.board.push(this.deck.pop()); this.street = 'turn'; }
    else if (this.street === 'turn') { this.board.push(this.deck.pop()); this.street = 'river'; }
    else { this.finish(); return; }

    const first = this.findNextToAct(this.button);
    if (first === -1 || this.canAct().length < 2) {
      // everyone is all-in — run the rest of the board out
      if (this.street !== 'river') { this.advanceStreet(); return; }
      this.finish(); return;
    }
    this.turn = first;
  }

  finish() {
    while (this.inHand().length > 1 && this.board.length < 5) this.board.push(this.deck.pop());
    this.street = 'showdown';
    this.handOver = true;

    const pots = buildPots(this.players);
    const contested = this.inHand();
    const scores = new Map();
    // With one player left everyone else folded: no board is dealt and no hand is
    // scored — they simply take it. Only score when there is something to compare.
    if (contested.length > 1) {
      for (const p of contested) scores.set(p.id, evaluate7([...p.hole, ...this.board]));
    } else if (contested.length === 1) {
      scores.set(contested[0].id, Infinity);
    }

    const awards = new Map();
    for (const pot of pots) {
      const contenders = pot.eligible.filter(id => scores.has(id));
      if (contenders.length === 0) continue;
      const best = Math.max(...contenders.map(id => scores.get(id)));
      const winners = contenders.filter(id => scores.get(id) === best);
      const share = Math.floor(pot.amount / winners.length);
      let remainder = pot.amount - share * winners.length;
      for (const id of winners) {
        awards.set(id, (awards.get(id) || 0) + share + (remainder-- > 0 ? 1 : 0));
      }
    }

    for (const [id, amount] of awards) {
      const p = this.players.find(x => x.id === id);
      p.chips += amount;
    }
    for (const p of this.players) if (p.chips <= 0) p.out = true;

    this.results = {
      awards: [...awards.entries()].map(([id, amount]) => ({ id, amount })),
      scores: contested.length > 1
        ? [...scores.entries()].map(([id, sc]) => ({ id, score: sc, name: handName(sc) }))
        : [],
      showdown: contested.length > 1,
    };
  }

  moveButton() { this.button = this.nextOccupied(this.button); }
}

/* ---------- equity by Monte Carlo ---------- */

export function equity(hole, board, opponents, iterations, rng) {
  const known = new Set([...hole, ...board]);
  const base = makeDeck().filter(c => !known.has(c));
  let win = 0, tie = 0;
  const need = 5 - board.length;

  for (let it = 0; it < iterations; it++) {
    // partial Fisher-Yates over the copy we need
    const pool = base.slice();
    const drawn = [];
    const total = need + opponents * 2;
    for (let i = 0; i < total; i++) {
      const j = i + Math.floor(rng() * (pool.length - i));
      [pool[i], pool[j]] = [pool[j], pool[i]];
      drawn.push(pool[i]);
    }
    const fullBoard = board.concat(drawn.slice(0, need));
    const mine = evaluate7([...hole, ...fullBoard]);
    let best = -1, ties = 0;
    for (let o = 0; o < opponents; o++) {
      const oh = [drawn[need + o * 2], drawn[need + o * 2 + 1]];
      const s = evaluate7([...oh, ...fullBoard]);
      if (s > best) best = s;
    }
    if (mine > best) win++;
    else if (mine === best) tie++;
  }
  return (win + tie / 2) / iterations;
}
