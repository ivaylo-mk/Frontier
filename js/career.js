import { Table, mulberry32 } from './engine.js';
import { Opponent, OPPONENT_ORDER, PERSONALITIES } from './ai.js';

// Chips are dollars. You buy in for $50 and sit down with $50 in front of you, so
// the chips on the table always add up to exactly the prize pool — no separate
// tournament currency to reconcile.
export const CITIES = [
  {
    id: 'deadwood',
    name: 'Deadwood',
    region: 'Dakota Territory',
    note: 'A gulch full of prospectors, no one in charge. Stakes are small, but every hand counts.',
    buyIn: 50, stack: 50, blinds: [1, 2], levelEvery: 12, difficulty: 0.15,
  },
  {
    id: 'dodge',
    name: 'Dodge City',
    region: 'Kansas',
    note: 'The cattle trail ends here and the drovers arrive paid. Longer games, colder players.',
    buyIn: 250, stack: 250, blinds: [5, 10], levelEvery: 11, difficulty: 0.42,
  },
  {
    id: 'tombstone',
    name: 'Tombstone',
    region: 'Arizona Territory',
    note: 'Silver money and short tempers. Nobody at this table is here to pass an evening.',
    buyIn: 750, stack: 750, blinds: [15, 30], levelEvery: 10, difficulty: 0.72,
  },
  {
    id: 'denver',
    name: 'Denver',
    region: 'Colorado',
    note: 'The highest-stakes game above a Larimer Street saloon. Only the best make it this far.',
    buyIn: 2500, stack: 2500, blinds: [50, 100], levelEvery: 9, difficulty: 1.0,
  },
];

export const PAYOUTS = [0.5, 0.3, 0.2];
const SAVE_KEY = 'frontier-poker-save-v1';

const STREETS_TRACKED = ['preflop', 'flop', 'turn', 'river'];

function blankActions() {
  const out = {};
  for (const s of STREETS_TRACKED) out[s] = { fold: 0, check: 0, call: 0, raise: 0 };
  return out;
}

export function blankStats() {
  return {
    won: 0, cashed: 0, earnings: 0, buyIns: 0,
    hands: 0, handsWon: 0, showdownsWon: 0, biggestPot: 0,
    sawFlop: 0, wentToShowdown: 0, dealtIn: 0, entered: 0,
    streak: 0, bestStreak: 0,
    you: blankActions(),
    them: blankActions(),
    winsByHand: {},
    theirWinsByHand: {},
  };
}

export { STREETS_TRACKED };

// Saves written by an earlier version carry a stats object with fewer fields. Fill in
// whatever is missing rather than checking for the object itself, which was the bug
// that stopped the statistics screen opening for anyone with an older save.
export function migrateStats(stats) {
  const fresh = blankStats();
  if (!stats || typeof stats !== 'object') return fresh;
  for (const key of Object.keys(fresh)) {
    const want = fresh[key];
    const have = stats[key];
    if (typeof want === 'number') {
      stats[key] = typeof have === 'number' ? have : want;
    } else if (key === 'you' || key === 'them') {
      stats[key] = have && typeof have === 'object' ? have : want;
      for (const street of STREETS_TRACKED) {
        const row = stats[key][street];
        stats[key][street] = row && typeof row === 'object'
          ? { fold: row.fold || 0, check: row.check || 0, call: row.call || 0, raise: row.raise || 0 }
          : { fold: 0, check: 0, call: 0, raise: 0 };
      }
    } else {
      stats[key] = have && typeof have === 'object' ? have : want;
    }
  }
  return stats;
}
const STARTING_BANKROLL = 200;

export function loadSave() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (!parsed.memory) parsed.memory = { folds: 0, showdowns: 0 };
      parsed.stats = migrateStats(parsed.stats);
      if (!parsed.achievements) parsed.achievements = {};
      return parsed;
    }
  } catch (e) { /* storage unavailable — play unsaved */ }
  return {
    bankroll: STARTING_BANKROLL, best: {}, played: 0, staked: 0,
    memory: { folds: 0, showdowns: 0 },
    stats: blankStats(),
    achievements: {},
  };
}

export function writeSave(save) {
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(save)); }
  catch (e) { /* ignore */ }
}

export function resetSave() {
  try { localStorage.removeItem(SAVE_KEY); } catch (e) { /* ignore */ }
  return loadSave();
}

/* ---------- tournament controller ---------- */

// Enough to rebuild a tournament between hands. The deck and the current hand are
// not stored, so resuming always begins a fresh hand.
export function snapshot(T, includeHand = false) {
  const t = T.table;
  const snap = {
    cityId: T.city.id,
    harder: T.harder,
    handNumber: T.handNumber,
    level: T.level,
    finishOrder: T.finishOrder.slice(),
    button: t.button,
    rng: T.rng.getState(),
    seats: t.players.map(p => ({ id: p.id, chips: p.chips, out: p.out })),
  };
  // The hand in progress, so refreshing does not cost you the cards you were dealt.
  if (includeHand && !t.handOver && t.deck) {
    snap.hand = {
      street: t.street, pot: t.pot, currentBet: t.currentBet,
      lastRaiseSize: t.lastRaiseSize, turn: t.turn, aggressor: t.aggressor,
      smallBlind: t.smallBlind, bigBlind: t.bigBlind,
      board: t.board.slice(), deck: t.deck.slice(),
      players: t.players.map(p => ({
        id: p.id, hole: p.hole.slice(), bet: p.bet, committed: p.committed,
        folded: p.folded, allIn: p.allIn, acted: p.acted,
      })),
    };
  }
  return snap;
}

export class Tournament {
  constructor(city, seed, opts = {}) {
    this.city = city;
    this.harder = !!opts.harder;
    this.memory = opts.memory || {};
    this.rng = mulberry32(seed >>> 0);
    this.handNumber = 0;
    this.finished = false;
    this.level = 0;
    this.finishOrder = [];

    const seats = [{ id: 'you', name: 'You', chips: city.stack }];
    for (const key of OPPONENT_ORDER) {
      seats.push({ id: key, name: PERSONALITIES[key].name, chips: city.stack });
    }
    this.bots = {};
    const difficulty = Math.min(1, city.difficulty + (this.harder ? 0.3 : 0));
    for (const key of OPPONENT_ORDER) {
      const bot = new Opponent(key, difficulty, this.rng, { harder: this.harder });
      bot.seed(this.memory);
      this.bots[key] = bot;
    }

    const saved = opts.restore;
    if (saved) {
      for (const seat of seats) {
        const was = saved.seats.find(x => x.id === seat.id);
        if (was) seat.chips = was.chips;
      }
    }

    this.table = new Table({
      players: seats,
      smallBlind: city.blinds[0],
      bigBlind: city.blinds[1],
      rng: this.rng,
      buttonIndex: saved ? saved.button : Math.floor(this.rng() * 6),
    });

    if (saved) {
      for (const p of this.table.players) {
        const was = saved.seats.find(x => x.id === p.id);
        if (was) { p.chips = was.chips; p.out = was.out; }
      }
      this.handNumber = saved.handNumber;
      this.level = saved.level;
      this.finishOrder = saved.finishOrder.slice();
      if (saved.rng !== undefined) this.rng.setState(saved.rng);
      if (saved.hand) this.restoreHand(saved.hand);
    }
  }

  // Put the table back exactly as it stood, so play continues from the same decision.
  restoreHand(h) {
    const t = this.table;
    t.street = h.street;
    t.pot = h.pot;
    t.currentBet = h.currentBet;
    t.lastRaiseSize = h.lastRaiseSize;
    t.turn = h.turn;
    t.aggressor = h.aggressor;
    t.smallBlind = h.smallBlind;
    t.bigBlind = h.bigBlind;
    t.board = h.board.slice();
    t.deck = h.deck.slice();
    t.handOver = false;
    t.results = null;
    t.log = [];
    for (const saved of h.players) {
      const p = t.players.find(x => x.id === saved.id);
      if (!p) continue;
      p.hole = saved.hole.slice();
      p.bet = saved.bet;
      p.committed = saved.committed;
      p.folded = saved.folded;
      p.allIn = saved.allIn;
      p.acted = saved.acted;
    }
    this.midHand = true;
  }

  blindsForLevel() {
    const [sb, bb] = this.city.blinds;
    const mult = Math.pow(1.5, this.level);
    return [Math.round(sb * mult), Math.round(bb * mult)];
  }

  startHand() {
    const before = this.table.livePlayers().map(p => p.id);
    if (this.handNumber > 0 && this.handNumber % this.city.levelEvery === 0) this.level++;
    const [sb, bb] = this.blindsForLevel();
    this.table.smallBlind = sb;
    this.table.bigBlind = bb;
    this.handNumber++;
    return this.table.startHand();
  }

  // Called after a hand resolves; records bust-outs in finishing order.
  recordEliminations() {
    const busted = this.table.players.filter(p => p.out && !this.finishOrder.includes(p.id));
    // Players who bust in the same hand are ranked by who had more chips at the start.
    busted.sort((a, b) => a.committed - b.committed);
    for (const p of busted) this.finishOrder.push(p.id);
  }

  isOver() { return this.table.livePlayers().length <= 1; }


  standings() {
    const survivors = this.table.livePlayers()
      .slice().sort((a, b) => b.chips - a.chips).map(p => p.id);
    return [...survivors, ...this.finishOrder.slice().reverse()];
  }

  // Place of the human, 1-indexed.
  placeOf(id) { return this.standings().indexOf(id) + 1; }

  prizeFor(place) {
    const pool = this.city.buyIn * 6;
    return place <= PAYOUTS.length ? Math.round(pool * PAYOUTS[place - 1]) : 0;
  }
}
