import { equity } from './engine.js';

// Each opponent is a set of dials on one shared decision procedure.
// enter      – equity needed to put money in preflop
// value      – equity above which they bet/raise for value
// callSlack  – how far below correct pot odds they will still call (station tuning)
// aggression – how often a profitable spot becomes a raise instead of a call
// bluff      – how often a hopeless hand fires anyway
// sizing     – bet as a fraction of pot
// Each opponent is a set of dials on one shared decision procedure.
//
// reads      – how much attention this one pays to how YOU play, 0 to 1
// enterRel / valueRel are expressed as a MULTIPLE OF A FAIR SHARE, not as raw
// equity. Against five opponents an average hand wins 1/6 of the time, so a raw
// threshold like 0.55 would mean folding literally everything. 1.0 means "an
// average hand for this many players"; 1.3 means "clearly better than average".
//
// enterRel   – how far above average a hand must be to enter a pot
// valueRel   – how far above average before they bet or raise it themselves
// callSlack  – how far past correct pot odds they will still call
// aggression – how often a profitable spot becomes a raise instead of a call
// bluff      – how often a hopeless hand fires anyway
// sizing     – bet as a fraction of the pot
export const PERSONALITIES = {
  bill: {
    name: 'Bill', avatar: 'bill',
    style: 'Reckless',
    blurb: 'Plays almost anything and bets like he means it. Wait for a real hand and let him pay you off.',
    reads: 0.2,          // how closely this one watches how you play
    enterRel: 0.66, valueRel: 1.10, callSlack: 0.06, aggression: 0.72, bluff: 0.30, sizing: [0.7, 1.1],
  },
  doc: {
    name: 'Doc', avatar: 'doc',
    style: 'Cold',
    blurb: 'Folds most hands, then attacks. When he raises big it usually means something.',
    reads: 0.5,          // how closely this one watches how you play
    enterRel: 1.0, valueRel: 1.30, callSlack: -0.02, aggression: 0.66, bluff: 0.16, sizing: [0.6, 0.9],
  },
  alice: {
    name: 'Alice', avatar: 'alice',
    style: 'Precise',
    blurb: 'Counts her odds and does not deviate. Almost never bluffs. If she calls you down, you were beaten.',
    reads: 0.35,          // how closely this one watches how you play
    enterRel: 1.06, valueRel: 1.38, callSlack: -0.04, aggression: 0.42, bluff: 0.04, sizing: [0.5, 0.75],
  },
  jane: {
    name: 'Jane', avatar: 'jane',
    style: 'Curious',
    blurb: 'Calls to see how it ends. Bluffing her is throwing money into the street, so value bet her instead.',
    reads: 0.1,          // how closely this one watches how you play
    enterRel: 0.62, valueRel: 1.55, callSlack: 0.16, aggression: 0.16, bluff: 0.05, sizing: [0.4, 0.6],
  },
  bat: {
    name: 'Bat', avatar: 'bat',
    style: 'Watchful',
    blurb: 'Reads the table more than the cards. He watches you closer than anyone here and adjusts to whatever you keep doing.',
    reads: 1.0,          // how closely this one watches how you play
    enterRel: 0.92, valueRel: 1.25, callSlack: 0.02, aggression: 0.55, bluff: 0.18, sizing: [0.55, 0.85],
    adaptive: true,
  },
};

export const OPPONENT_ORDER = ['bill', 'alice', 'doc', 'jane', 'bat'];

// City difficulty sharpens the dials: tighter entry, more bluffing, more simulations.
// City difficulty sharpens the dials: tighter entry, more bluffing, more simulations.
export function tune(base, difficulty, opts = {}) {
  const d = difficulty; // 0 .. 1
  const harder = opts.harder ? 1 : 0;
  return {
    ...base,
    enterRel: base.enterRel + 0.08 * d,          // tighter starting hands
    valueRel: base.valueRel - 0.07 * d,          // value bets thinner
    callSlack: base.callSlack - 0.05 * d,        // fewer loose calls
    aggression: Math.min(0.92, base.aggression + 0.18 * d),
    bluff: Math.min(0.45, base.bluff + 0.14 * d),
    // More simulations means a better read of where the hand actually stands.
    iterations: Math.round((400 + 500 * d) * (harder ? 2 : 1)),
    // Everyone watches you a little; Harder makes all of them noticeably sharper.
    reads: Math.min(1, base.reads * (harder ? 1.8 : 1)),
  };
}

export class Opponent {
  constructor(key, difficulty, rng, opts = {}) {
    this.key = key;
    this.profile = tune(PERSONALITIES[key], difficulty, opts);
    this.rng = rng;
    // What they already know about the player, carried in from earlier tournaments.
    this.playerFolds = opts.memory?.folds || 0;
    this.playerShowdowns = opts.memory?.showdowns || 0;
  }

  // Bat watches how often the human gives up a pot.
  noteHumanFold() { this.playerFolds++; }
  noteHumanShowdown() { this.playerShowdowns++; }

  seed(memory) {
    if (!memory) return;
    this.playerFolds = memory.folds || 0;
    this.playerShowdowns = memory.showdowns || 0;
  }

  memory() { return { folds: this.playerFolds, showdowns: this.playerShowdowns }; }

  // Adjusting to an opponent cuts both ways. Someone who folds too often can be bet
  // at profitably, because the pot is won without a showdown. Someone who folds too
  // rarely cannot be bluffed, so the answer is to bet good hands thinner instead.
  // Neither is a punishment for caution; each is the counter to a readable tendency.
  read() {
    const w = this.profile.reads || 0;
    const n = this.playerFolds + this.playerShowdowns;
    if (!w || n < 5) return { bluff: 0, value: 0 };
    const foldRate = this.playerFolds / n;
    if (foldRate > 0.6) return { bluff: 0.19 * w, value: 0 };
    if (foldRate < 0.3) return { bluff: -0.10 * w, value: -0.13 * w };
    return { bluff: 0, value: 0 };
  }

  decide({ table, seat }) {
    const p = table.players[seat];
    const la = table.legalActions(seat);
    const pr = this.profile;
    const rng = this.rng;

    const opponents = Math.max(1, table.inHand().length - 1);
    const iters = table.street === 'preflop' ? Math.round(pr.iterations * 0.6) : pr.iterations;
    const eq = equity(p.hole, table.board, opponents, iters, rng);

    // Equity as a multiple of a fair share of the pot. 1.0 is an average holding
    // for the number of players still in, whatever that number happens to be.
    let rel = eq * (opponents + 1);

    // Acting late is worth a little extra courage.
    const order = table.players.filter(x => !x.folded && !x.out).map(x => x.seat);
    const posFactor = order.indexOf(seat) / Math.max(1, order.length - 1);
    rel += 0.12 * (posFactor - 0.5);

    const read = this.read();
    const bluffBonus = read.bluff;
    const valueBar = pr.valueRel + read.value;
    const potOdds = la.toCall > 0 ? la.toCall / (table.pot + la.toCall) : 0;
    const pot = table.pot;

    const raiseTo = (frac) => {
      const target = Math.round(table.currentBet + Math.max(pot * frac, table.bigBlind * 2));
      return Math.max(la.minRaiseTo, Math.min(target, la.maxRaiseTo));
    };
    const size = () => pr.sizing[0] + rng() * (pr.sizing[1] - pr.sizing[0]);

    // --- nothing to call ---
    if (la.canCheck) {
      if (rel > valueBar && rng() < pr.aggression && la.canRaise) {
        return { type: 'raise', to: raiseTo(size()) };
      }
      // Having raised last street, follow through on this one. Checking after
      // taking the lead tells the table the hand missed.
      if (table.aggressor === p.id && table.street !== 'preflop' && la.canRaise) {
        const follow = 0.45 + 0.40 * pr.aggression;
        if (rng() < follow) return { type: 'raise', to: raiseTo(0.55) };
      }
      if (rel < 0.7 && rng() < pr.bluff + bluffBonus && la.canRaise) {
        return { type: 'raise', to: raiseTo(0.5) };
      }
      return { type: 'check' };
    }

    // --- facing a bet: pot odds decide, personality bends the edges ---
    const margin = eq - potOdds;

    // Preflop, enterRel is the bar for playing at all. Below it the hand goes in the
    // muck, unless the price is one big blind or less and the hand is close to the bar.
    if (table.street === 'preflop' && rel < pr.enterRel) {
      const cheap = la.toCall <= table.bigBlind && rel > pr.enterRel - 0.16;
      if (!cheap) return { type: 'fold' };
    }

    if (margin > 0.10 && rel > valueBar && la.canRaise && rng() < pr.aggression) {
      return { type: 'raise', to: raiseTo(size()) };
    }
    // Before the flop the price is small and the hand still has room to improve, so
    // there is a little more room to come along. After it, discipline is unchanged.
    const slack = pr.callSlack + (table.street === 'preflop' ? 0.07 : 0);
    if (margin > -slack) return { type: 'call' };
    if (la.canRaise && rng() < (pr.bluff + bluffBonus) * 0.5 && la.toCall < pot * 0.4) {
      return { type: 'raise', to: raiseTo(0.6) };
    }
    return { type: 'fold' };
  }

}
