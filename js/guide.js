// Reference material for the Help and Odds panels.
// Kept separate from game logic so the text can be edited without touching the engine.

export const RANKS_HI_LO = ['A', 'K', 'Q', 'J', 'T', '9', '8', '7', '6', '5', '4', '3', '2'];

/* ---------------- hand rankings cheat sheet ---------------- */

export const HAND_GUIDE = [
  { name: 'Straight Flush', cards: ['5H', '6H', '7H', '8H', '9H'],
    note: 'Five in a row, all one suit. Ace-high makes it a royal flush.' },
  { name: 'Four Of A Kind', cards: ['QS', 'QH', 'QD', 'QC', '3S'],
    note: 'All four of one rank.' },
  { name: 'Full House', cards: ['8S', '8H', '8D', 'KC', 'KS'],
    note: 'Three of one rank and two of another. Ties go to the higher trips.' },
  { name: 'Flush', cards: ['AD', 'JD', '8D', '6D', '3D'],
    note: 'Any five of one suit. Ties go to the highest card, then the next.' },
  { name: 'Straight', cards: ['6S', '7C', '8D', '9H', '10S'],
    note: 'Five in a row, mixed suits. Ace plays low in A-2-3-4-5.' },
  { name: 'Three Of A Kind', cards: ['7S', '7H', '7D', 'KC', '4S'],
    note: 'Three of one rank. Called a set when two come from your hole cards.' },
  { name: 'Two Pair', cards: ['JS', 'JH', '5D', '5C', 'AS'],
    note: 'Two different pairs. The higher pair is compared first.' },
  { name: 'One Pair', cards: ['9S', '9H', 'AD', '7C', '4S'],
    note: 'Two of one rank. Wins more pots than beginners expect.' },
  { name: 'High Card', cards: ['AS', 'JH', '8D', '5C', '3S'],
    note: 'Nothing made. The highest card plays, then the next.' },
];

/* ---------------- preflop ranges by position ---------------- */

// Standard six-handed opening ranges, written in the usual chart notation.
// These are a starting point rather than gospel. good players widen or tighten
// them depending on who is left to act behind them.
export const POSITIONS = [
  {
    key: 'SB', name: 'Small Blind', short: 'SB', pct: '29% of hands',
    seat: 'Posts half a bet, acts first after the flop.',
    advice: 'You act first for the rest of the hand. If you play, raise rather than just call.',
    range: ['22+', 'A2s+', 'K6s+', 'Q8s+', 'J8s+', 'T8s+', '97s+', '86s+', '76s', '65s',
            'A8o+', 'K9o+', 'Q9o+', 'JTo'],
  },
  {
    key: 'BB', name: 'Big Blind', short: 'BB', pct: '48% defended',
    seat: 'Posts a full bet, acts last before the flop.',
    advice: 'Your bet is already in, so it costs you less to continue. Keep playing weaker hands here than you would elsewhere.',
    range: ['22+', 'A2s+', 'K2s+', 'Q5s+', 'J7s+', 'T7s+', '96s+', '85s+', '75s+', '64s+', '54s',
            'A2o+', 'K7o+', 'Q8o+', 'J8o+', 'T8o+', '97o+', '87o', '76o'],
  },
  {
    key: 'UTG', name: 'Under The Gun', short: 'UTG', pct: '12% of hands',
    seat: 'First to act, three seats right of the button.',
    advice: 'The seat to be most careful in. Raise only with hands you are happy to keep playing if someone raises you back.',
    range: ['22+', 'ATs+', 'KTs+', 'QTs+', 'JTs', 'AQo+', 'KQo'],
  },
  {
    key: 'HJ', name: 'Hijack', short: 'HJ', pct: '15% of hands',
    seat: 'Two seats right of the button.',
    advice: 'There are four players still to act after you, one fewer than under the gun. That is enough of a difference to start raising with suited hands.',
    range: ['22+', 'A9s+', 'K9s+', 'QTs+', 'J9s+', 'T9s', '98s', 'AJo+', 'KJo+'],
  },
  {
    key: 'CO', name: 'Cutoff', short: 'CO', pct: '20% of hands',
    seat: 'One seat right of the button.',
    advice: 'Only two players act after you, so it often folds round and you win without a fight. Worth raising with a lot more hands than you would from an early seat.',
    range: ['22+', 'A2s+', 'K9s+', 'Q9s+', 'J9s+', 'T8s+', '98s', '87s', '76s', 'ATo+', 'KJo+', 'QJo'],
  },
  {
    key: 'BTN', name: 'Button', short: 'BTN', pct: '38% of hands',
    seat: 'The seat with the dealer button.',
    advice: 'Last to act after the flop. The best seat at the table.',
    range: ['22+', 'A2s+', 'K5s+', 'Q8s+', 'J8s+', 'T7s+', '96s+', '86s+', '75s+', '65s', '54s',
            'A7o+', 'A5o-A2o', 'K9o+', 'Q9o+', 'J9o+', 'T9o', '98o'],
  },
];

const IDX = Object.fromEntries(RANKS_HI_LO.map((r, i) => [r, i]));

// Expand chart notation ("22+", "ATs+", "A5o-A2o", "JTs") into a set of hand keys.
export function expandRange(tokens) {
  const set = new Set();
  for (const token of tokens) {
    if (token.includes('-')) {
      const [a, b] = token.split('-');
      const suit = a.slice(2);
      const hi = a[0];
      for (let k = IDX[a[1]]; k <= IDX[b[1]]; k++) set.add(hi + RANKS_HI_LO[k] + suit);
      continue;
    }
    const plus = token.endsWith('+');
    const body = plus ? token.slice(0, -1) : token;
    const suit = body.length === 3 ? body[2] : '';
    const [x, y] = [body[0], body[1]];

    if (x === y) { // pairs
      const limit = plus ? 0 : IDX[x];
      for (let i = IDX[x]; i >= limit; i--) set.add(RANKS_HI_LO[i] + RANKS_HI_LO[i]);
      continue;
    }
    const limit = plus ? IDX[x] + 1 : IDX[y];
    for (let k = IDX[y]; k >= limit; k--) set.add(x + RANKS_HI_LO[k] + suit);
  }
  return set;
}

// Key for a grid cell: row/col index into RANKS_HI_LO. Suited above the diagonal.
export function cellKey(row, col) {
  const a = RANKS_HI_LO[Math.min(row, col)];
  const b = RANKS_HI_LO[Math.max(row, col)];
  if (row === col) return a + a;
  return a + b + (col > row ? 's' : 'o');
}

/* ---------------- rules and strategy ---------------- */

export const GUIDE_SECTIONS = [
  {
    heading: 'How A Hand Plays',
    body: [
      'The game is Texas Hold\u2019em. Each player gets two private cards, called hole cards, and five shared cards, called community cards, are dealt face up on the table.',
      'The five community cards come out in three stages: three at once (the flop), then one (the turn), then one more (the river). You make the best five-card hand you can using any combination of your two hole cards and the five community cards.',
      'There is a round of betting before the flop and after each stage. If everyone except one player folds, that player wins the pot without showing their cards.',
    ],
  },
  {
    heading: 'Hand Rankings',
    body: [
      'Every hand from a straight flush down to high card, with an example of each. Worth a look whenever you need a reminder of what beats what.',
    ],
    link: ['Hand Rankings', 'help'],
  },
  {
    heading: 'Your Actions',
    body: [
      'When it is your turn, the actions available to you depend on what has happened before you.',
      { terms: [
        ['Fold', 'Give up your hand and take no further part in the pot.'],
        ['Check', 'Stay in the hand without betting. Only possible when nobody has bet before you.'],
        ['Bet', 'Put chips in when nobody has bet yet this round.'],
        ['Call', 'Match the current bet to stay in the hand.'],
        ['Raise', 'Increase the current bet, so the others must match the higher amount or fold.'],
      ] },
      'Betting and raising share one button at the table, and it always shows the total you would be putting in.',
    ],
  },
  {
    heading: 'The Blinds And The Badges',
    body: [
      'Before any cards are dealt, two players are required to put money in. These forced bets, the blinds, are what keep the game moving.',
      'Three badges show who they are.',
      { terms: [
        ['D', 'The dealer button. This player acts last after the flop.'],
        ['SB', 'The small blind, who posts half a bet.'],
        ['BB', 'The big blind, who posts a full bet.'],
      ] },
      'After every hand all three move one seat to the left, so everyone takes a turn in each position and pays the blinds equally.',
      'Your own badge appears in the middle of your card panel when you hold one of them, and your position is named next to your chips. A white outline marks whoever is deciding.',
      'The blinds climb as the tournament goes on, which puts pressure on anyone waiting rather than playing.',
    ],
  },
  {
    heading: 'Opening Ranges',
    body: [
      'Which two cards are worth raising with depends on where you are sitting. The chart lays out every possible starting hand for each of the six seats.',
      'Worth a look before you play, and again once positions start to make sense.',
    ],
    link: ['Opening Ranges Chart', 'ranges'],
  },
  {
    heading: 'Why Position Matters',
    body: [
      'Position is when you act during a betting round.',
      'After the flop, action starts with the first player to the left of the dealer button and goes clockwise. The button acts last.',
      'Acting later is an advantage, because you have already seen what everyone else did before you decide. The same cards are worth more with that information than without it.',
      'The button is the most profitable seat and the blinds are the least. Play more hands from late positions and fewer from early ones, rather than the same hands from every seat.',
    ],
  },
  {
    heading: 'Pot Odds',
    body: [
      'Pot odds tell you whether the price of a call is worth the reward.',
      'Say the pot holds $100 and an opponent bets $50. Calling costs you $50 and would make the final pot $200.',
      { formula: ['Call \u00f7 Final Pot = Required Win %', { text: '$50 \u00f7 $200 = 25%', muted: true }] },
      'So you need to win at least a quarter of the time for the call to break even. Compare that with your chance of winning, which the odds panel shows you. If your chance is higher than the price, the call makes money over time.',
    ],
  },
  {
    heading: 'Counting Your Outs',
    body: [
      'An out is a card that would turn your hand into one you expect to win with.',
      'Say you hold two hearts and two more come on the flop. You need one more heart for a flush. There are thirteen hearts in the deck and you can see four, which leaves nine outs.',
      { formula: ['One Card To Come: Outs \u00d7 2', 'Two Cards To Come: Outs \u00d7 4'] },
      'Nine outs on the turn is roughly 18% to hit on the river. Nine outs on the flop is roughly 36% to hit by the river.',
      'These are quick estimates rather than exact figures, and not every out is clean. A card that improves your hand can give someone else a better one.',
      'Once you have your estimate, compare it with the pot odds to decide whether calling is worth it.',
    ],
  },
  {
    heading: 'Five Habits That Win Money',
    body: [
      { sub: 'Play Fewer Hands' },
      'Most losing players play far too many. If your cards are not strong enough to raise with, they are usually not worth calling with either.',
      { sub: 'Play The Hands You Keep Aggressively' },
      'Betting can win two ways: everyone folds, or you have the best hand. Calling only wins one way.',
      { sub: 'Use Your Position' },
      'When you act last you have already seen what everyone else did. Play more hands from late seats and fewer from early ones.',
      { sub: 'Watch The Player, Not Just The Cards' },
      'Someone who folds too often can be pressured with well-timed bets. Someone who calls almost everything cannot be bluffed, so bet your good hands and let them pay. Look for who plays too many hands, who folds easily, and who turns aggressive.',
      { sub: 'Know Why You Are Betting' },
      'You want worse hands to call or better hands to fold. If neither is likely, checking is usually better than betting because it is your turn.',
    ],
  },
];



/* ---------------- who these people were ---------------- */

export const OPPONENT_HISTORY = {
  bill: 'Lawman, army scout and showman, famous in his lifetime for his speed with a pistol and for the hours he spent at the card tables. In 1876 he was shot in the back of the head during a hand in a Deadwood saloon. The two pair he was holding, aces and eights, has been called the dead man\u2019s hand ever since.',
  alice: 'An English schoolteacher who came west and became a professional card player, dealing and gambling across Colorado and South Dakota for forty years. She worked out the odds in her head, smoked cigars at the table, and won more than $250,000 at cards over her career. She refused to play on a Sunday.',
  doc: 'A dentist who moved west after falling ill with tuberculosis and made his living at the card tables instead, dealing faro and playing poker from Texas to Colorado. In 1881 he fought beside the Earp brothers in the gunfight at the O.K. Corral in Tombstone. He died six years later at a hotel in Glenwood Springs, Colorado.',
  jane: 'Army scout, wagon driver and rider in travelling Wild West shows, as well known in the saloons and gambling halls as she was on the trail. She drank and played cards with the soldiers she rode alongside, and in later life earned a living telling stories about her own adventures, most of them exaggerated.',
  bat: 'Buffalo hunter, army scout and sheriff of Dodge City, who dealt faro and played cards for a living between his jobs as a lawman. He survived a gunfight in Sweetwater that left him with a limp, and spent his last years in New York as a newspaper sports writer. He died of a heart attack at his desk with an unfinished column in front of him.',
};

export const OPPONENT_DATES = {
  bill: '1837 to 1876',
  alice: '1851 to 1930',
  doc: '1851 to 1887',
  jane: '1856 to 1903',
  bat: '1853 to 1921',
};

// Hands strong enough to raise from any seat. used to colour the range chart.
export const CORE_RANGE = ['22+', 'ATs+', 'KTs+', 'QTs+', 'JTs', 'AQo+', 'KQo'];


/* ---------------- achievements ---------------- */

export const ACHIEVEMENTS = [
  { id: 'first_blood', name: 'First Blood', how: 'Win your first hand.' },
  { id: 'high_noon', name: 'High Noon', how: 'Win a heads-up showdown.' },
  { id: 'last_stand', name: 'Last Stand', how: 'Win a hand after going all-in.' },
  { id: 'cold_blooded', name: 'Cold-Blooded', how: 'Win five hands in a row.' },
  { id: 'high_roller', name: 'High Roller', how: 'Win a pot worth $1,000 or more.' },
  { id: 'river_boat', name: 'River Boat', how: 'Win with a Full House.' },
  { id: 'four_horsemen', name: 'Four Horsemen', how: 'Win with Four of a Kind.' },
  { id: 'royal_flush', name: 'Frontier Royalty', how: 'Win with a Royal Flush.' },
  { id: 'dead_mans_hand', name: "Dead Man's Hand", how: 'Win with two black aces and two black eights.' },
  { id: 'legend', name: 'Legend of the Frontier', how: 'Win every tournament.' },
];
