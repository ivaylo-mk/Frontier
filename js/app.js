import { cardCode, cardRank, cardSuit, handName, evaluate7, bestFive, handOdds, mulberry32 } from './engine.js';
import { PERSONALITIES, OPPONENT_ORDER } from './ai.js';
import { CITIES, Tournament, snapshot, loadSave, writeSave, resetSave, blankStats, migrateStats, STREETS_TRACKED } from './career.js';
import { HAND_GUIDE, POSITIONS, GUIDE_SECTIONS, RANKS_HI_LO, expandRange, cellKey,
         OPPONENT_HISTORY, OPPONENT_DATES, CORE_RANGE, ACHIEVEMENTS } from './guide.js';

const $ = (sel) => document.querySelector(sel);
const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
};
const money = (n) => '$' + n.toLocaleString('en-US');
const chips = (n) => '$' + n.toLocaleString('en-US');
const wait = (ms) => new Promise(r => setTimeout(r, ms));

// Assets resolve to files normally, or to inlined data URIs in the standalone build.
const BUNDLE = typeof window !== 'undefined' ? window.__BUNDLE__ : null;
const cardSrc = (code) => BUNDLE ? BUNDLE.cards[code || 'back'] : `assets/cards/${code || 'back'}.svg`;
const starSrc = () => (BUNDLE && BUNDLE.star) ? BUNDLE.star : 'assets/star.png';
const avatarSrc = (key) => BUNDLE ? BUNDLE.avatars[key] : `assets/avatars/${key}.png`;
const portraitSrc = (key) => (BUNDLE && BUNDLE.portraits) ? BUNDLE.portraits[key] : `assets/avatars/full/${key}.jpg`;

let save = loadSave();
if (!save.speed) save.speed = 'standard';
if (!save.difficulty) save.difficulty = 'standard';
save.stats = migrateStats(save.stats);
if (!save.achievements) save.achievements = {};
// Purely how long a decision is displayed as taking. It does not change the decision.
const THINK = { fast: [380, 420], standard: [1350, 900] };
let T = null;              // active Tournament
let session = 0;           // bumped when a tournament ends or is abandoned
let humanResolve = null;   // resolves when the player picks an action
let raiseValue = 0;
let lastAction = {};       // id -> label shown under the avatar
let oddsRng = mulberry32(7);
let oddsCache = null;      // { boardLen, data } — recomputed as each street opens

/* ---------------- career screen ---------------- */

function renderCareer() {
  show('career');
  $('#bankroll').textContent = money(save.bankroll);
  const unlocked = ACHIEVEMENTS.filter(a => save.achievements[a.id]).length;
  $('#achieveCount').textContent = unlocked + '/' + ACHIEVEMENTS.length;
  const list = $('#cityList');
  list.innerHTML = '';


  if (save.resume) {
    const city = CITIES.find(c => c.id === save.resume.cityId);
    const left = save.resume.seats.filter(x => !x.out).length;
    if (city) {
      const card = el('button', 'city city-resume');
      const head = el('div', 'city-head');
      const title = el('div', 'city-title');
      title.append(el('h3', null, 'Resume ' + city.name));
      title.append(el('p', 'city-region', `Hand ${Math.max(1, save.resume.handNumber)} \u00b7 ${left} players left`));
      head.append(title);
      const you = save.resume.seats.find(x => x.id === 'you');
      head.append(el('div', 'city-buyin', chips(you ? you.chips : 0)));
      card.append(head);
      card.append(el('p', 'city-note', 'Your table is still standing. Pick up from the next hand.'));
      card.addEventListener('click', () => startTournament(city, save.resume));
      list.append(card);
    } else {
      save.resume = null;
    }
  }

  for (const city of CITIES) {
    const locked = save.bankroll < city.buyIn;
    const card = el('button', 'city' + (locked ? ' locked' : ''));
    card.disabled = locked;

    const head = el('div', 'city-head');
    const title = el('div', 'city-title');
    title.append(el('h3', null, 'Play at ' + city.name));
    title.append(el('p', 'city-region', city.region));
    head.append(title);
    head.append(el('div', 'city-buyin', money(city.buyIn)));
    card.append(head);

    card.append(el('p', 'city-note', city.note));

    const foot = el('div', 'city-foot');
    const best = save.best[city.id];
    foot.append(el('span', 'city-meta', best ? `Best finish: ${ordinal(best)}` : 'Not yet played'));
    foot.append(el('span', 'city-meta', locked
      ? 'Buy-in short'
      : `Winner takes ${money(Math.round(city.buyIn * 6 * 0.5))}`));
    card.append(foot);

    card.addEventListener('click', () => {
      if (save.resume) {
        askConfirm('Start A New Tournament?',
          `You still have a seat at ${CITIES.find(c => c.id === save.resume.cityId)?.name || 'a table'}. `
          + 'Starting here forfeits it, along with that buy-in.',
          'Start New', () => { save.resume = null; startTournament(city); });
        return;
      }
      startTournament(city);
    });
    list.append(card);
  }

  const broke = save.bankroll < CITIES[0].buyIn;
  $('#stakeRow').hidden = !broke;
}

function ordinal(n) {
  const teen = n % 100 >= 11 && n % 100 <= 13;
  const suffix = teen ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] || 'th');
  return n + suffix;
}

/* ---------------- table screen ---------------- */

function startTournament(city, restore = null) {
  if (T && !T.finished) return;   // ignore a double tap on the city card
  if (!restore) {
    save.bankroll -= city.buyIn;   // already paid for if we are resuming
    save.played++;
    save.stats.buyIns += city.buyIn;
  }
  writeSave(save);

  T = new Tournament(city, Date.now(), {
    harder: save.difficulty === 'harder',
    memory: save.memory,
    restore,
  });
  T.session = ++session;
  save.resume = snapshot(T);
  writeSave(save);
  lastAction = {};
  $('#venue').textContent = city.name;
  show('table');
  buildSeats();
  runTournament();
}

function buildSeats() {
  const row = $('#seats');
  row.innerHTML = '';
  for (const key of OPPONENT_ORDER) {
    const p = PERSONALITIES[key];
    const seat = el('div', 'seat');
    seat.id = 'seat-' + key;
    const av = el('div', 'seat-av');
    const img = el('img');
    img.src = avatarSrc(p.avatar);
    img.alt = '';
    av.append(img);
    av.append(el('span', 'pos-chip', ''));
    seat.append(av);
    seat.append(el('div', 'seat-name', p.name));
    seat.append(el('div', 'seat-chips', ''));
    seat.append(el('div', 'seat-action', ''));
    const held = el('div', 'seat-cards');
    held.append(cardEl(null), cardEl(null));
    seat.append(held);
    seat.title = `${p.style} — ${p.blurb}`;
    row.append(seat);
  }
}

function cardEl(code, cls) {
  const img = el('img', 'card ' + (cls || ''));
  img.src = cardSrc(code);
  img.alt = code || 'face down';
  return img;
}

function render() {
  const t = T.table;
  const [sb, bb] = T.blindsForLevel();
  const STREET = { preflop: 'Pre-Flop', flop: 'Flop', turn: 'Turn', river: 'River', showdown: 'Showdown' };
  $('#streetMeta').textContent = STREET[t.street] || '';
  $('#blindMeta').textContent = `Blinds ${chips(sb)} / ${chips(bb)}`;

  for (const key of OPPONENT_ORDER) {
    const p = t.players.find(x => x.id === key);
    const seat = $('#seat-' + key);
    seat.classList.toggle('is-out', p.out);
    seat.classList.toggle('is-folded', p.folded && !p.out);
    seat.classList.toggle('is-turn', !t.handOver && t.turn === p.seat && !p.folded);
    seat.querySelector('.seat-chips').textContent = p.out ? 'Out' : chips(p.chips);
    const chip = seat.querySelector('.pos-chip');
    const role = seatRole(t, p.seat);
    chip.textContent = role || '';
    chip.hidden = !role;
    chip.className = 'pos-chip' + (role === 'D' ? ' is-button' : '');
    // The row keeps its slot at all times; only visibility changes, so dealing a
    // hand never reflows the rest of the screen.
    const held = seat.querySelector('.seat-cards');
    const holding = !p.folded && !p.out && p.hole.length > 0;
    held.style.visibility = holding ? 'visible' : 'hidden';

    const act = seat.querySelector('.seat-action');
    const label = lastAction[key] || '';
    act.textContent = label;
    act.className = 'seat-action' + toneOf(label);
  }

  // Built once and then only updated in place. Rebuilding it on every render
  // restarted the images and made the board flicker while bots acted quickly.
  const board = $('#board');
  if (board.children.length !== 5) {
    board.innerHTML = '';
    for (let i = 0; i < 5; i++) board.append(el('div', 'card card-slot'));
  }
  // Cards that have just landed animate in, staggered, so a flop deals one by one.
  let dealt = 0;
  for (let i = 0; i < 5; i++) {
    const slot = board.children[i];
    const want = t.board[i] !== undefined ? cardSrc(cardCode(t.board[i])) : null;
    if (want) {
      if (slot.tagName !== 'IMG') {
        const img = cardEl(cardCode(t.board[i]));
        img.classList.add('card-dealt');
        img.style.animationDelay = (dealt++ * 130) + 'ms';
        board.replaceChild(img, slot);
      } else if (slot.src !== want) slot.src = want;
    } else if (slot.tagName === 'IMG') {
      board.replaceChild(el('div', 'card card-slot'), slot);
    }
  }

  $('#pot').textContent = chips(t.pot);

  const me = t.players[0];
  const hole = $('#hole');
  if (hole.children.length !== 2) {
    hole.innerHTML = '';
    hole.append(cardEl(null), cardEl(null));
  }
  const showHole = me.hole.length && !me.out;
  hole.style.visibility = showHole ? 'visible' : 'hidden';
  if (showHole) {
    const imgs = hole.children;
    for (let i = 0; i < 2; i++) {
      const want = cardSrc(cardCode(me.hole[i]));
      if (imgs[i].src !== want) { imgs[i].src = want; imgs[i].alt = cardCode(me.hole[i]); }
    }
  }
  $('#myChips').textContent = me.out ? 'Eliminated' : chips(me.chips);
  $('#myPos').textContent = me.out ? '' : positionName(t, 0);
  const myBadge = $('#myBadge');
  const myRole = me.out ? '' : seatRole(t, 0);
  myBadge.textContent = myRole;
  myBadge.className = 'pos-chip me-badge' + (myRole === 'D' ? ' is-button' : '');
  $('#myHand').textContent = me.hole.length && t.board.length >= 3 && !me.folded
    ? handName(evaluate7([...me.hole, ...t.board]))
    : '';
}

// Probabilities a player would actually work out at the table: how often this hand
// wins as it stands, and what it is likely to finish as by the river.
function computeOdds() {
  const t = T && !T.finished ? T.table : null;
  const me = t?.players[0];
  if (!t || !me || me.folded || me.out || !me.hole.length) { oddsCache = null; return; }
  if (oddsCache && oddsCache.boardLen === t.board.length) return;
  const opponents = Math.max(1, t.inHand().length - 1);
  oddsCache = { boardLen: t.board.length, data: handOdds(me.hole, t.board, opponents, 900, oddsRng) };
  if (!$('#modal').hidden && modalView === 'odds') openModal('odds');
}

// Who is on the button and who is posting, so the rotation reads at a glance.
function seatRole(t, seat) {
  if (t.button === seat) return 'D';
  const live = t.players.filter(p => !p.out).map(p => p.seat);
  if (live.length < 2) return '';
  const after = (from) => live[(live.indexOf(from) + 1) % live.length];
  const sb = live.length === 2 ? t.button : after(t.button);
  if (seat === sb) return 'SB';
  if (seat === after(sb)) return 'BB';
  return '';
}

// Full six-handed position names, counted back from the button.
const POS_NAMES = ['Button', 'Cutoff', 'Hijack', 'Under The Gun'];
function positionName(t, seat) {
  const role = seatRole(t, seat);
  if (role === 'D') return 'Button';
  if (role === 'SB') return 'Small Blind';
  if (role === 'BB') return 'Big Blind';
  const live = t.players.filter(p => !p.out).map(p => p.seat);
  let steps = 0, i = live.indexOf(seat);
  while (live[i] !== t.button && steps < live.length) { i = (i + 1) % live.length; steps++; }
  return POS_NAMES[steps] || '';
}

// The engine reports what happened; wording and currency belong here.
function actionLabel(e) {
  if (e.type === 'fold') return 'Fold';
  if (e.type === 'check') return 'Check';
  if (e.allIn) return 'All In';
  if (e.type === 'call') return `Call ${chips(e.amount)}`;
  return `Raise ${chips(e.amount)}`;
}

// Fold, check, call and raise counts per street, kept separately for you and the table.
function recordAction(isYou, street, type) {
  const book = isYou ? save.stats.you : save.stats.them;
  const row = book && book[street];
  if (!row || !(type in row)) return;
  row[type]++;
}

// Everything is judged from the hand that just finished, so nothing is awarded twice
// and nothing needs replaying to be noticed.
function checkAchievements(t, won, wasAllIn) {
  const st = save.stats;
  const earn = (id) => {
    if (save.achievements[id]) return;      // never twice
    save.achievements[id] = Date.now();
    pendingAchievements.push(id);
  };

  // Counting milestones, judged from counters already updated for this hand.
  if (st.handsWon >= 1) earn('first_blood');
  if (st.handsWon >= 10) earn('wanted');
  if (st.handsWon >= 50) earn('most_wanted');
  if (st.hands >= 100) earn('long_trail');
  if (st.showdownsWon >= 25) earn('sundown');
  if (st.biggestPot >= 1000) earn('high_roller');
  if (st.bestStreak >= 5) earn('cold_blooded');
  if (st.earnings >= 10000) earn('gold_rush');

  if (won) {
    if (wasAllIn) earn('last_stand');
    // Won before a single community card was dealt.
    if (t.board.length === 0) earn('quick_draw');

    // Hand categories come from the same evaluator the game scores with, and only
    // count at a showdown, where the hand was actually shown down and beaten.
    if (t.results?.showdown) {
      if (t.inHand().length === 2) earn('high_noon');
      const me = t.players[0];
      const cards = [...me.hole, ...t.board];
      const five = bestFive(cards);
      const name = handName(evaluate7(cards));
      if (name === 'Three of a Kind') earn('three_guns');
      if (name === 'Straight') earn('straight_shooter');
      if (name === 'Flush') earn('red_river');
      if (name === 'Full House') earn('river_boat');
      if (name === 'Four of a Kind') earn('four_horsemen');
      if (name === 'Straight Flush' && Math.min(...five.map(cardRank)) === 10) earn('royal_flush');
      // Pocket aces means the two cards you were dealt, not a pair made with the board.
      if (me.hole.length === 2 && me.hole.every(c => cardRank(c) === 14)) earn('ace_in_the_hole');
      const codes = new Set(five.map(cardCode));
      if (['AS', 'AC', '8S', '8C'].every(c => codes.has(c))) earn('dead_mans_hand');
    }
  }

  if (CITIES.every(c => save.best[c.id] === 1)) earn('legend');
}

let pendingAchievements = [];

function toneOf(label) {
  if (!label) return '';
  if (label === 'Fold') return ' tone-fold';
  if (label === 'All In') return ' tone-allin';
  if (label.startsWith('Raise') || label.startsWith('Bet')) return ' tone-raise';
  if (label.startsWith('Call') || label === 'Check') return ' tone-call';
  return '';
}

/* ---------------- controls ---------------- */

function showControls(la) {
  const t = T.table;
  const me = t.players[0];
  $('#controls').hidden = false;

  $('#btnFold').hidden = !la.canCall;
  $('#btnCheck').hidden = !la.canCheck;
  $('#btnCall').hidden = !la.canCall;
  $('#btnCall').textContent = la.callAmount >= me.chips ? 'Call All In' : `Call ${chips(la.callAmount)}`;

  const canRaise = la.canRaise && la.maxRaiseTo > la.minRaiseTo;
  $('#raiseRow').hidden = !la.canRaise;
  $('#btnRaise').hidden = !la.canRaise;

  if (la.canRaise) {
    const slider = $('#raiseSlider');
    slider.min = la.minRaiseTo;
    slider.max = la.maxRaiseTo;
    slider.step = Math.max(1, Math.round(t.bigBlind / 2));
    raiseValue = Math.min(la.maxRaiseTo, Math.max(la.minRaiseTo, Math.round(t.pot * 0.6 + t.currentBet)));
    slider.value = raiseValue;
    slider.disabled = !canRaise;
    updateRaise();
  }
}

function updateRaise() {
  const t = T.table;
  const la = t.legalActions(0);
  const slider = $('#raiseSlider');
  const step = Number(slider.step) || 1;
  raiseValue = Math.max(la.minRaiseTo, Math.min(Number(slider.value), la.maxRaiseTo));
  // The step almost never divides the stack exactly, so the top of the track would
  // otherwise stop just short of all-in. Snap the last step up to the real maximum.
  if (raiseValue >= la.maxRaiseTo - step) raiseValue = la.maxRaiseTo;
  const isAllIn = raiseValue >= la.maxRaiseTo;
  const me = t.players[0];
  $('#raiseAmount').textContent = isAllIn ? 'All In' : chips(raiseValue);
  $('#raiseCost').textContent = isAllIn
    ? 'Your Whole Stack'
    : `Costs You ${chips(raiseValue - me.bet)}`;
  $('#btnRaise').textContent = isAllIn ? 'All In' : `Raise ${chips(raiseValue)}`;
  const pct = (raiseValue - Number($('#raiseSlider').min)) /
    Math.max(1, Number($('#raiseSlider').max) - Number($('#raiseSlider').min));
  $('#raiseSlider').style.setProperty('--fill', (pct * 100) + '%');
}

function hideControls() { $('#controls').hidden = true; }

function bindControls() {
  $('#btnFold').onclick = () => submit({ type: 'fold' });
  $('#btnCheck').onclick = () => submit({ type: 'check' });
  $('#btnCall').onclick = () => submit({ type: 'call' });
  $('#btnRaise').onclick = () => submit({ type: 'raise', to: raiseValue });
  $('#raiseSlider').oninput = updateRaise;
  $('#btnStepDown').onclick = () => nudge(-1);
  $('#btnStepUp').onclick = () => nudge(1);
}

function nudge(dir) {
  const s = $('#raiseSlider');
  s.value = Number(s.value) + dir * Number(s.step);
  updateRaise();
}

function submit(action) {
  if (!humanResolve) return;
  $('#meBox').classList.remove('is-turn');
  hideControls();
  const r = humanResolve;
  humanResolve = null;
  r(action);
}

function humanTurn() {
  if (T && !T.finished) { save.resume = snapshot(T, true); writeSave(save); }
  $('#meBox').classList.add('is-turn');
  computeOdds();
  showControls(T.table.legalActions(0));
  return new Promise(res => { humanResolve = res; });
}

/* ---------------- main loop ---------------- */

async function runTournament() {
  const t = T.table;
  const mine = T.session;
  const alive = () => T && T.session === mine;

  let midHand = T.midHand;
  while (!T.isOver()) {
    if (!alive()) return;
    if (midHand) {
      midHand = false;          // resumed: carry on with the hand already dealt
      T.midHand = false;
      render();
    } else {
      lastAction = {};
      oddsCache = null;
      if (!T.startHand()) break;
      render();
      await wait(320);
    }

    let shownStreet = t.street;
    let countedEntry = false;
    let wasAllIn = false;
    if (!t.players[0].out) save.stats.dealtIn++;
    while (!t.handOver) {
      if (!alive()) return;
      // New cards land before anyone reacts to them.
      if (t.street !== shownStreet) {
        const fresh = t.street === 'flop' ? 3 : 1;
        shownStreet = t.street;
        lastAction = {};        // last street's moves are history now
        render();
        await wait(340 + fresh * 150);
      }
      const seat = t.turn;
      const p = t.players[seat];
      render();

      let action;
      if (p.id === 'you') {
        action = await humanTurn();
      } else {
        const bot = T.bots[p.id];
        lastAction[p.id] = 'Thinking';
        render();
        const [base, spread] = THINK[save.speed] || THINK.fast;
        await wait(base + Math.random() * spread);
        action = bot.decide({ table: t, seat });
      }

      const actedStreet = t.street;
      t.act(action);
      recordAction(p.id === 'you', actedStreet, action.type);
      if (p.id === 'you' && t.players[0].allIn) wasAllIn = true;
      if (p.id === 'you' && actedStreet === 'preflop' && !countedEntry) {
        countedEntry = true;
        if (action.type === 'call' || action.type === 'raise') save.stats.entered++;
      }
      const entry = t.log[t.log.length - 1];
      if (entry) lastAction[entry.player] = actionLabel(entry);

      if (p.id === 'you' && action.type === 'fold') {
        save.memory.folds++;
        for (const k of OPPONENT_ORDER) T.bots[k].noteHumanFold();
      }
      render();
      await wait(240);
    }

    // Bat is watching whether you show down or give up.
    if (!t.players[0].folded && t.results?.showdown) {
      save.memory.showdowns++;
      for (const k of OPPONENT_ORDER) T.bots[k].noteHumanShowdown();
    }

    const won = t.results?.awards.find(a => a.id === 'you');
    save.stats.hands++;
    const me0 = t.players[0];
    if (!me0.folded && !me0.out && t.board.length >= 3) save.stats.sawFlop++;
    if (!me0.folded && t.results?.showdown) save.stats.wentToShowdown++;
    if (t.results?.showdown) {
      for (const award of t.results.awards) {
        if (award.amount <= 0) continue;
        const score = t.results.scores.find(x => x.id === award.id);
        if (!score) continue;
        const book = award.id === 'you' ? save.stats.winsByHand : save.stats.theirWinsByHand;
        book[score.name] = (book[score.name] || 0) + 1;
      }
    }
    save.stats.streak = won ? save.stats.streak + 1 : 0;
    if (save.stats.streak > save.stats.bestStreak) save.stats.bestStreak = save.stats.streak;
    if (won) {
      save.stats.handsWon++;
      if (won.amount > save.stats.biggestPot) save.stats.biggestPot = won.amount;
      if (t.results.showdown) save.stats.showdownsWon++;
    }
    // Every counter is up to date before anything is judged, so a milestone unlocks
    // on the hand that reaches it rather than the one after.
    checkAchievements(t, won, wasAllIn);

    await revealHand();
    await flushAchievements();
    T.recordEliminations();
    t.moveButton();

    if (t.players[0].out) break;
    if (!T.isOver()) { save.resume = snapshot(T); writeSave(save); }
  }

  if (!alive()) return;
  finishTournament();
}

// "a flush" and "a full house" take an article; "two pair" and "high card" do not.
const NO_ARTICLE = new Set(['High Card', 'Two Pair', 'Three of a Kind', 'Four of a Kind']);
const handPhrase = (name) => (NO_ARTICLE.has(name) ? name : 'a ' + name);

// Shown when cards are turned over, so the winning hand can be seen properly.
function showShowdown(lead, phrase, handName, five) {
  const el0 = $('#showdownLine');
  el0.innerHTML = '';
  el0.append(document.createTextNode(lead));
  const prefix = phrase.slice(0, phrase.length - handName.length);
  if (prefix) el0.append(document.createTextNode(prefix));
  el0.append(el('span', 'showdown-hand', handName));
  const holder = $('#showdownCards');
  holder.innerHTML = '';
  for (const card of five) holder.append(cardEl(cardCode(card)));
  $('#showdown').hidden = false;
  return new Promise((resolve) => {
    const done = () => { $('#showdown').hidden = true; resolve(); };
    $('#showdownGo').onclick = done;
    $('#showdown').onclick = (e) => { if (e.target === $('#showdown')) done(); };
  });
}

async function revealHand() {
  const t = T.table;
  const res = t.results;
  if (!res) return;

  if (res.showdown) {
    // show remaining hole cards
    for (const p of t.inHand()) {
      if (p.id === 'you') continue;
      const seat = $('#seat-' + p.id);
      const holder = seat.querySelector('.seat-cards');
      holder.style.visibility = 'visible';
      const imgs = holder.querySelectorAll('img');
      imgs[0].src = cardSrc(cardCode(p.hole[0]));
      imgs[1].src = cardSrc(cardCode(p.hole[1]));
      const s = res.scores.find(x => x.id === p.id);
      if (s) lastAction[p.id] = s.name;
    }
    render();
    await wait(1500);
    for (const seat of document.querySelectorAll('.seat-cards')) {
      seat.querySelectorAll('img').forEach(img => { img.src = cardSrc(null); });
    }
  }

  const winners = res.awards.filter(a => a.amount > 0);
  if (!winners.length) { render(); return; }

  const names = winners.map(w => t.players.find(p => p.id === w.id).name);
  const total = winners.reduce((s, w) => s + w.amount, 0);
  const verb = winners.length > 1 ? 'split' : (names[0] === 'You' ? 'win' : 'wins');

  if (res.showdown) {
    const top = res.scores.filter(x => winners.some(w => w.id === x.id))[0];
    const winner = t.players.find(p => p.id === winners[0].id);
    const five = bestFive([...winner.hole, ...t.board]);
    await showShowdown(
      `${names.join(' and ')} ${verb} ${chips(total)} with `,
      handPhrase(top.name), top.name, five);
  } else {
    const banner = $('#banner');
    banner.textContent = `${names.join(' and ')} ${verb} ${chips(total)}`;
    banner.hidden = false;
    await wait(1300);
    banner.hidden = true;
  }
  render();
}

/* ---------------- results ---------------- */

function finishTournament() {
  hideControls();
  T.finished = true;
  session++;
  save.resume = null;
  const place = T.placeOf('you');
  const prize = T.prizeFor(place);
  save.bankroll += prize;
  if (place === 1) save.stats.won++;
  if (prize > 0) { save.stats.cashed++; save.stats.earnings += prize; }
  const prev = save.best[T.city.id];
  if (!prev || place < prev) save.best[T.city.id] = place;
  // Prize money and the town record are final now, so Gold Rush and Legend are
  // judged here rather than mid-hand.
  checkAchievements(T.table, null, false);
  writeSave(save);   // includes what the table learned about you this tournament

  $('#resultPlace').textContent = ordinal(place);
  $('#resultCity').textContent = `${T.city.name}, ${T.city.region}`;
  $('#resultPrize').textContent = prize > 0 ? money(prize) : 'Nothing';
  $('#resultLine').textContent = prize > 0
    ? (place === 1 ? 'You took the table.' : 'You cashed.')
    : 'You busted out. The buy-in stays on the table.';
  $('#resultBankroll').textContent = money(save.bankroll);
  show('result');
  flushAchievements();
}

/* ---------------- popups ---------------- */

const REAL_NAMES = {
  bill: 'James Butler \u201cWild Bill\u201d Hickok',
  alice: 'Alice Ivers Duffield \u2014 \u201cPoker Alice\u201d',
  doc: 'John Henry \u201cDoc\u201d Holliday',
  jane: 'Martha Jane Canary \u2014 \u201cCalamity Jane\u201d',
  bat: 'Bartholomew \u201cBat\u201d Masterson',
};

let modalView = null;
let modalStack = [];        // panels behind the current one, so Back always retraces
let rangePosition = 'SB';

function openModal(view, opts = {}) {
  if (opts.root) modalStack = [];
  else if (modalView && modalView !== view) modalStack.push(modalView);

  // Arriving at the chart selects the seat you are in; tapping a tab does not.
  if (view === 'ranges' && !opts.keepPosition) {
    rangePosition = currentPositionKey() || 'SB';
  }
  modalView = view;
  const body = $('#modalBody');
  body.innerHTML = '';
  $('#modalTitle').textContent =
    view === 'opponents' ? 'Opponents' :
    view === 'odds' ? 'Odds' :
    view === 'help' ? 'Hand Rankings' :
    view === 'ranges' ? 'Opening Ranges' :
    view === 'settings' || view === 'gameSettings' ? 'Settings' :
    view === 'stats' ? 'Statistics' :
    view === 'achievements' ? 'Achievements' :
    view === 'rules' ? 'Guide' : 'Menu';

  ({ menu: buildMenu, opponents: buildOpponents, odds: buildOdds, help: buildHelp,
     ranges: buildRanges, rules: buildRules, settings: buildSettings,
     gameSettings: buildGameSettings, stats: buildStats,
     achievements: buildAchievements })[view](body);

  $('#modal').hidden = false;
  const panel = $('.sheet-panel');
  panel.scrollTop = 0;
  markScrollable(panel);
  // Fonts and the 169-cell grid can settle a frame later and drag the scroll with
  // them, so pin it again once layout has run.
  const afterLayout = window.requestAnimationFrame || ((fn) => setTimeout(fn, 0));
  afterLayout(() => { panel.scrollTop = 0; });
}

// A soft fade at the foot of the panel, shown only while there is more below.
function markScrollable(panel) {
  const update = () => {
    const more = panel.scrollHeight - panel.clientHeight - panel.scrollTop > 8;
    $('#modal').classList.toggle('has-more', more);
  };
  panel.onscroll = update;
  update();
  const later = window.requestAnimationFrame || ((fn) => setTimeout(fn, 0));
  later(update);
}

function closeModal() {
  $('#modal').hidden = true;
  $('#modal').classList.remove('has-more');
  modalView = null;
  modalStack = [];
}

// A dialog styled like the rest of the app, instead of the browser's own.
function askConfirm(title, body, okLabel, onOk) {
  $('#confirmTitle').textContent = title;
  $('#confirmBody').textContent = body;
  $('#confirmOk').textContent = okLabel;
  $('#confirm').hidden = false;
  const close = () => { $('#confirm').hidden = true; };
  $('#confirmOk').onclick = () => { close(); onOk(); };
  $('#confirmCancel').onclick = close;
  $('#confirm').onclick = (e) => { if (e.target === $('#confirm')) close(); };
}

// Which of the six seats the player is in right now, so the chart opens on it.
function currentPositionKey() {
  const t = T && !T.finished ? T.table : null;
  if (!t || t.players[0].out) return null;
  const name = positionName(t, 0);
  return ({ 'Button': 'BTN', 'Small Blind': 'SB', 'Big Blind': 'BB',
            'Cutoff': 'CO', 'Hijack': 'HJ', 'Under The Gun': 'UTG' })[name] || null;
}

function navRow(body, label, view) {
  const b = el('button', 'menu-item', label);
  b.addEventListener('click', () => openModal(view));
  body.append(b);
}

// Only shown when there is somewhere to go back to.
function backRow(body) {
  body.append(el('div', 'nav-gap'));
  const b = el('button', 'menu-item menu-back', 'Back');
  b.addEventListener('click', () => {
    if (!modalStack.length) { closeModal(); return; }
    const prev = modalStack.pop();
    const rest = modalStack.slice();
    openModal(prev, { keepPosition: true, root: true });
    modalStack = rest;
  });
  body.append(b);
}

function segment(body, options, current, onPick) {
  const row = el('div', 'seg');
  for (const [key, label] of options) {
    const b = el('button', 'seg-btn' + (current === key ? ' is-on' : ''), label);
    b.addEventListener('click', () => onPick(key));
    row.append(b);
  }
  body.append(row);
}

function buildSpeedSection(body, reopen) {
  body.append(el('h3', 'odds-sub', 'Game Speed'));
  body.append(el('p', 'sheet-note',
    'Changes how quickly opponents act, without affecting their decisions.'));
  segment(body, [['standard', 'Standard'], ['fast', 'Fast']], save.speed, (key) => {
    save.speed = key; writeSave(save); openModal(reopen);
  });
}

function buildDifficultySection(body, reopen) {
  body.append(el('h3', 'odds-sub', 'Difficulty'));
  segment(body, [['standard', 'Standard'], ['harder', 'Harder']], save.difficulty, (key) => {
    save.difficulty = key; writeSave(save); openModal(reopen);
  });
  body.append(el('p', 'sheet-note', save.difficulty === 'harder'
    ? 'Opponents evaluate their cards more accurately before deciding and read your playstyle and habits more closely for weaknesses to exploit. They remember your style from game to game until you reset, with changes taking effect in the next tournament.'
    : 'Opponents judge their cards carefully before deciding and study your playstyle and habits for weaknesses to exploit. They remember your style from game to game until you reset, with changes taking effect in the next tournament.'));
  }

// Reads the numbers you have actually produced and describes the shape of your game.
// Two axes, the same two every poker book uses: how many hands you play, and how
// often you take the lead when you do.
function playStyleRead() {
  const st = save.stats;
  const all = (book) => STREETS_TRACKED.reduce((acc, k) => {
    for (const a of ['fold', 'check', 'call', 'raise']) acc[a] += book[k][a];
    return acc;
  }, { fold: 0, check: 0, call: 0, raise: 0 });

  const you = all(st.you);
  const decisions = you.fold + you.check + you.call + you.raise;
  if (st.dealtIn < 18 || decisions < 30) {
    return {
      label: 'Not Enough Hands Yet',
      lines: [`Your style is worked out once you have been dealt 18 hands. You have played ${st.dealtIn}.`],
      wide: null, aggr: null,
    };
  }

  // Two measures every poker book uses: how many hands you enter, and how often you
  // take the lead once you are in.
  const wide = st.entered / st.dealtIn;
  const aggr = (you.call + you.raise) ? you.raise / (you.call + you.raise) : 0;
  const foldRate = you.fold / decisions;

  const loose = wide > 0.35;
  const pushy = aggr > 0.45;
  const label = (loose ? 'Loose' : 'Tight') + ' And ' + (pushy ? 'Aggressive' : 'Passive');

  const pct = (v) => Math.round(v * 100) + '%';
  const lines = [];

  if (wide < 0.12) {
    lines.push(`You enter the pot with only ${pct(wide)} of the hands you are dealt. That is tighter than almost anyone plays, and it means folding hands that would make money.`);
  } else if (loose) {
    lines.push(`You enter the pot with ${pct(wide)} of the hands you are dealt. Most winning players sit nearer a quarter, so you are seeing flops with hands that will often be second best.`);
  } else {
    lines.push(`You enter the pot with ${pct(wide)} of the hands you are dealt, which is a disciplined range and the right starting point.`);
  }

  lines.push(pushy
    ? `Once you are in, ${pct(aggr)} of your money goes in as a raise rather than a call. You are usually the one setting the price.`
    : `Once you are in, only ${pct(aggr)} of your money goes in as a raise. You are mostly paying the price others set.`);

  if (loose && pushy) {
    lines.push('Aggression is the right instinct, but applied to too many hands it leaks chips. Fold more before the flop and keep betting the ones you keep.');
  } else if (loose && !pushy) {
    lines.push('Playing many hands and rarely raising is the most expensive habit in poker. Every hand worth a call is usually worth a raise or a fold.');
  } else if (!loose && pushy) {
    lines.push('Tight and aggressive is the shape most winning players have. From here the gains come from picking which opponents to push.');
  } else if (wide < 0.12) {
    lines.push('Waiting for near certainties means the blinds eat you while you wait. Widen your starting hands before worrying about anything else.');
  } else {
    lines.push('You pick good hands and then play them softly, which wins small pots and loses big ones. Raise more of the hands you already choose to play.');
  }

  if (foldRate > 0.55) {
    lines.push(`You fold on ${pct(foldRate)} of your decisions. The opponents track that and will bet at you more often because of it.`);
  } else if (foldRate < 0.2) {
    lines.push(`You fold on only ${pct(foldRate)} of your decisions, so the opponents have stopped bluffing you and value bet you thinner instead.`);
  }

  return { label, lines, wide, aggr };
}

function buildAchievements(body) {
  const unlocked = ACHIEVEMENTS.filter(a => save.achievements[a.id]).length;
  body.append(el('p', 'sheet-note', `${unlocked} of ${ACHIEVEMENTS.length} earned.`));
  for (const a of ACHIEVEMENTS) {
    const got = !!save.achievements[a.id];
    const card = el('div', 'ach' + (got ? ' is-got' : ''));
    const text = el('div', 'ach-text');
    text.append(el('div', 'ach-name', a.name));
    text.append(el('p', 'ach-how', a.how));
    card.append(text);
    if (got) {
      const star = el('img', 'ach-star');
      star.src = starSrc();
      star.alt = 'Earned';
      card.append(star);
    }
    body.append(card);
  }
  backRow(body);
}

function buildStats(body) {
  const st = save.stats;

  const read = playStyleRead();
  body.append(el('h3', 'odds-sub', 'Play Style'));
  const card = el('div', 'style-card');
  card.append(el('div', 'style-label', read.label));
  if (read.wide !== null) {
    const bars = el('div', 'style-bars');
    for (const [name, value, left, right] of [
      ['Hands Played', read.wide, 'Tight', 'Loose'],
      ['Raises Over Calls', read.aggr, 'Passive', 'Aggressive'],
    ]) {
      const row = el('div', 'style-bar');
      row.append(el('span', 'style-bar-name', name));
      const track = el('span', 'style-track');
      const dot = el('span', 'style-dot');
      dot.style.left = Math.min(96, Math.max(4, value * 100)) + '%';
      track.append(dot);
      row.append(track);
      const ends = el('span', 'style-ends');
      ends.append(el('span', null, left));
      ends.append(el('span', null, right));
      row.append(ends);
      bars.append(row);
    }
    card.append(bars);
  }
  for (const line of read.lines) card.append(el('p', 'style-line', line));
  body.append(card);

  const acts = actionTable();
  if (acts) {
    body.append(el('h3', 'odds-sub', 'You Against The Opponents'));
    body.append(el('p', 'sheet-note', 'Share of decisions on each street, with the five opponents beside you for comparison.'));
    body.append(acts);
  }

  const yours = winningHands(st.winsByHand);
  const theirs = winningHands(st.theirWinsByHand);
  if (yours || theirs) {
    if (yours) {
      body.append(el('h3', 'odds-sub', 'Your Winning Hands'));
      body.append(yours);
    }
    if (theirs) {
      body.append(el('h3', 'odds-sub', 'Opponent Winning Hands'));
      body.append(theirs);
    }
    body.append(el('p', 'sheet-note foot-note',
      'Counted at showdown only, so this is what hands actually looked like when the money went in.'));
  }

  body.append(el('h3', 'odds-sub', 'At The Table'));
  const seen = save.memory.folds + save.memory.showdowns;
  body.append(statTable([
    ['Hands Played', String(st.hands)],
    ['Pots Won', String(st.handsWon)],
    ['Won At Showdown', String(st.showdownsWon)],
    ['Biggest Pot', st.biggestPot ? money(st.biggestPot) : '\u2014'],
    ['Win Rate', st.hands ? Math.round(100 * st.handsWon / st.hands) + '%' : '\u2014'],
    ['Hands You Folded', seen ? Math.round(100 * save.memory.folds / seen) + '%' : '\u2014'],
  ]));

  body.append(el('h3', 'odds-sub', 'Tournaments'));
  body.append(statTable([
    ['Tournaments Played', String(save.played)],
    ['Won Outright', String(st.won)],
    ['Finished In The Money', String(st.cashed)],
    ['Prize Money', money(st.earnings)],
    ['Paid In Buy-Ins', money(st.buyIns)],
    ['Net', netLabel(st.earnings - st.buyIns)],
  ]));

  body.append(el('h3', 'odds-sub', 'Best Finish'));
  body.append(statTable(CITIES.map(c => [c.name, save.best[c.id] ? ordinal(save.best[c.id]) : 'Not played'])));

  backRow(body);
}

function actionTable() {
  const st = save.stats;
  const anything = STREETS_TRACKED.some((k) => {
    const r = st.you[k];
    return r.fold + r.check + r.call + r.raise > 0;
  });
  if (!anything) return null;

  const table = el('div', 'acts');

  const head = el('div', 'acts-row acts-head');
  head.append(el('span', 'acts-who', ''));
  for (const label of ['Fold', 'Check', 'Call', 'Raise']) head.append(el('span', 'acts-cell', label));
  table.append(head);

  for (const street of STREETS_TRACKED) {
    const mine = st.you[street];
    const theirs = st.them[street];
    const nMine = mine.fold + mine.check + mine.call + mine.raise;
    if (!nMine) continue;
    const nTheirs = theirs.fold + theirs.check + theirs.call + theirs.raise;

    table.append(el('div', 'acts-street', STREET_LABEL[street] || street));
    for (const [who, row, n, cls] of [['You', mine, nMine, 'is-you'], ['Opponents', theirs, nTheirs, 'is-them']]) {
      if (!n) continue;
      const line = el('div', 'acts-row ' + cls);
      line.append(el('span', 'acts-who', who));
      for (const a of ['fold', 'check', 'call', 'raise']) {
        line.append(el('span', 'acts-cell', Math.round(100 * row[a] / n) + '%'));
      }
      table.append(line);
    }
  }
  return table;
}

const STREET_LABEL = { preflop: 'Pre-Flop', flop: 'Flop', turn: 'Turn', river: 'River' };

function winningHands(book) {
  const wins = Object.entries(book).sort((a, b) => b[1] - a[1]);
  if (!wins.length) return null;
  const total = wins.reduce((n, w) => n + w[1], 0);
  const list = el('ul', 'odds-list');
  for (const [name, n] of wins) {
    const li = el('li', 'odds-row');
    li.append(el('span', 'odds-name', name));
    const bar = el('span', 'odds-bar');
    const fill = el('span', 'odds-fill');
    fill.style.width = Math.max(3, (n / wins[0][1]) * 100) + '%';
    bar.append(fill);
    li.append(bar);
    li.append(el('span', 'odds-pct', Math.round(100 * n / total) + '%'));
    list.append(li);
  }
  return list;
}

// Zero is just zero; only a real gain or loss takes a sign.
function netLabel(n) {
  if (n === 0) return money(0);
  return (n > 0 ? '+' : '\u2212') + money(Math.abs(n));
}

function statTable(rows) {
  const list = el('dl', 'stats');
  for (const [label, value] of rows) {
    const row = el('div', 'stat-row');
    row.append(el('dt', 'stat-label', label));
    row.append(el('dd', 'stat-value', value));
    list.append(row);
  }
  return list;
}

function buildSettings(body) {
  buildDifficultySection(body, 'settings');
  buildSpeedSection(body, 'settings');

  body.append(el('h3', 'odds-sub', 'Start Again'));
  body.append(el('p', 'sheet-note', 'Erases your bankroll, your results, and everything the opponents have learned about you.'));
  const reset = el('button', 'menu-item menu-danger', 'Reset Game');
  reset.addEventListener('click', () => {
    closeModal();
    askConfirm('Reset Game?', 'This erases your bankroll, your results, and everything the others have learned about you.',
      'Reset', () => {
        save = resetSave();
        save.stats = blankStats();
        save.speed = 'standard';
        save.difficulty = 'standard';
        writeSave(save);
        renderCareer();
      });
  });
  body.append(reset);
  backRow(body);
}

function buildGameSettings(body) {
  buildDifficultySection(body, 'gameSettings');
  buildSpeedSection(body, 'gameSettings');
  backRow(body);
}

function buildMenu(body) {
  navRow(body, 'Achievements', 'achievements');
  navRow(body, 'Statistics', 'stats');
  navRow(body, 'Opponents', 'opponents');
  navRow(body, 'Guide', 'rules');
  navRow(body, 'Settings', 'gameSettings');
  // Stepping away keeps the seat. The tournament is saved and waiting.
  const leave = el('button', 'menu-item menu-gold', 'Main Menu');
  leave.addEventListener('click', () => {
    if (T && !T.finished) { save.resume = snapshot(T, true); }
    writeSave(save);
    session++;
    if (T) { T.finished = true; T = null; }
    hideControls();
    closeModal();
    renderCareer();
  });
  body.append(leave);

  const forfeit = el('button', 'menu-item menu-danger', 'Forfeit Tournament');
  forfeit.addEventListener('click', () => {
    closeModal();
    askConfirm('Forfeit The Tournament?',
      'Your chips and your buy-in are gone. This cannot be undone.',
      'Forfeit', () => {
        session++;
        if (T) { T.finished = true; T = null; }
        save.resume = null;
        writeSave(save);
        hideControls();
        renderCareer();
      });
  });
  body.append(forfeit);
}

function buildOpponents(body) {
  body.append(el('p', 'sheet-note',
    'All five were real people, and each one plays the way their reputation suggests.'));
  for (const key of OPPONENT_ORDER) {
    const prof = PERSONALITIES[key];
    const p = T?.table.players.find(x => x.id === key);
    const row = el('div', 'opp');
    const img = el('img', 'opp-av');
    img.src = avatarSrc(prof.avatar);
    img.alt = prof.name;
    img.addEventListener('click', () => showPortrait(prof.avatar, prof.name));
    row.append(img);
    const txt = el('div', 'opp-text');
    const head = el('div', 'opp-head');
    head.append(el('span', 'opp-name', prof.name));
    head.append(el('span', 'opp-style', prof.style));
    txt.append(head);
    txt.append(el('p', 'opp-real', REAL_NAMES[key]));
    txt.append(el('p', 'opp-dates', OPPONENT_DATES[key]));
    txt.append(el('p', 'opp-blurb', prof.blurb));
    txt.append(el('p', 'opp-history', OPPONENT_HISTORY[key]));
    row.append(txt);
    body.append(row);
  }
  body.append(el('p', 'sheet-note foot-note is-centred',
    'Playing styles are drawn from what each of these people was known for and shaped for the game. Portraits are original artistic interpretations.'));
  backRow(body);
}

function buildOdds(body) {
  const t = T && !T.finished ? T.table : null;
  const me = t?.players[0];
  const live = t && me && me.hole.length && !me.folded && !me.out;
  computeOdds();
  const o = live ? oddsCache?.data : null;

  if (!o) {
    body.append(el('p', 'sheet-note',
      'No live hand to read right now. The chart below stays available whenever you want it.'));
    body.append(el('div', 'nav-gap'));
    navRow(body, 'Opening Ranges Chart', 'ranges');
    return;
  }

  const top = el('div', 'odds-top');
  top.append(el('span', 'odds-label', 'Chance To Win This Hand'));
  top.append(el('span', 'odds-win', Math.round(o.win * 100) + '%'));
  body.append(top);

  const opponents = Math.max(1, t.inHand().length - 1);
  body.append(el('p', 'sheet-note',
    `Against ${opponents} player${opponents > 1 ? 's' : ''} still in, with ${5 - t.board.length} card${5 - t.board.length === 1 ? '' : 's'} to come.`));

  const made = t.board.length >= 3 ? handName(evaluate7([...me.hole, ...t.board])) : null;
  const rows = o.categories.filter(c => c.p >= 0.02 && c.name !== 'High Card')
    .sort((a, b) => b.p - a.p).slice(0, 6);

  body.append(el('h3', 'odds-sub', 'Likely Final Hand'));
  const list = el('ul', 'odds-list');
  for (const c of rows) {
    const li = el('li', 'odds-row' + (c.name === made ? ' is-made' : ''));
    li.append(el('span', 'odds-name', c.name));
    const bar = el('span', 'odds-bar');
    const fill = el('span', 'odds-fill');
    fill.style.width = Math.max(2, c.p * 100) + '%';
    bar.append(fill);
    li.append(bar);
    li.append(el('span', 'odds-pct', Math.round(c.p * 100) + '%'));
    list.append(li);
  }
  if (!rows.length) list.append(el('li', 'odds-empty', 'Nothing likely yet'));
  body.append(list);

  const la = t.legalActions(0);
  if (la.toCall > 0) {
    const price = la.toCall / (t.pot + la.toCall);
    const good = o.win > price;
    const note = el('div', 'price' + (good ? ' is-good' : ''));
    note.append(el('span', 'price-label', 'Price Of Calling'));
    note.append(el('span', 'price-value', Math.round(price * 100) + '%'));
    body.append(note);
    body.append(el('p', 'sheet-note',
      good
        ? `You need to win ${Math.round(price * 100)}% of the time to break even and you win ${Math.round(o.win * 100)}%. Calling shows a profit over the long run.`
        : `You need to win ${Math.round(price * 100)}% of the time to break even but you only win ${Math.round(o.win * 100)}%. Calling loses money over the long run.`));
  }

  const gap = el('div', 'nav-gap');
  body.append(gap);
  navRow(body, 'Opening Ranges Chart', 'ranges');
}

function buildRanges(body) {
  const pos = POSITIONS.find(p => p.key === rangePosition) || POSITIONS[3];
  const core = expandRange(CORE_RANGE);

  const tabs = el('div', 'tabs');
  for (const p of POSITIONS) {
    const b = el('button', 'tab' + (p.key === pos.key ? ' is-on' : ''), p.short);
    b.addEventListener('click', () => { rangePosition = p.key; openModal('ranges', { keepPosition: true }); });
    tabs.append(b);
  }
  body.append(tabs);

  const head = el('div', 'range-head');
  head.append(el('h3', 'range-name', 'Player Position: ' + pos.name));
  head.append(el('span', 'range-pct', pos.pct));
  body.append(head);
  body.append(el('p', 'range-seat', pos.seat));

  const set = expandRange(pos.range);
  const grid = el('div', 'grid');
  for (let r = 0; r < 13; r++) {
    for (let c = 0; c < 13; c++) {
      const key = cellKey(r, c);
      const inRange = set.has(key);
      const cls = 'cell' + (inRange ? (core.has(key) ? ' is-core' : ' is-wide') : '');
      const cell = el('div', cls, key);
      grid.append(cell);
    }
  }
  body.append(grid);

  const legend = el('div', 'legend');
  for (const [cls, label] of [['is-core', 'Usually Safe To Raise'],
                              ['is-wide', 'Caution When Raising'],
                              ['', 'Usually Safer To Fold']]) {
    const item = el('span', 'legend-item');
    item.append(el('span', 'legend-dot ' + cls));
    item.append(el('span', null, label));
    legend.append(item);
  }
  body.append(legend);
  const key = el('p', 'suit-key');
  key.append(document.createTextNode('Cards of the same suit are marked '));
  key.append(el('b', 'mark', 's'));
  key.append(document.createTextNode(' for suited. Cards of different suits are marked '));
  key.append(el('b', 'mark', 'o'));
  key.append(document.createTextNode(' for offsuit.'));
  body.append(key);

  body.append(el('p', 'sheet-note', pos.advice));
  backRow(body);
}

function buildHelp(body) {
  body.append(el('h3', 'odds-sub', 'Strongest First'));
  for (const h of HAND_GUIDE) {
    const row = el('div', 'rank-row');
    const cards = el('div', 'rank-cards');
    for (const c of h.cards) {
      const img = el('img', 'rank-card');
      img.src = cardSrc(c);
      img.alt = '';
      cards.append(img);
    }
    row.append(cards);
    const txt = el('div');
    txt.append(el('div', 'rank-name', h.name));
    txt.append(el('p', 'rank-note', h.note));
    row.append(txt);
    body.append(row);
  }
  backRow(body);
}

function buildRules(body) {
  for (const sec of GUIDE_SECTIONS) {
    body.append(el('h3', 'odds-sub', sec.heading));
    for (const block of sec.body) {
      if (typeof block === 'string') { body.append(el('p', 'sheet-note', block)); continue; }
      if (block.sub) { body.append(el('h4', 'guide-sub', block.sub)); continue; }
      if (block.terms) {
        const list = el('dl', 'terms');
        for (const [term, def] of block.terms) {
          const row = el('div', 'term-row');
          row.append(el('dt', 'term', term));
          row.append(el('dd', 'term-def', def));
          list.append(row);
        }
        body.append(list);
        continue;
      }
      if (block.formula) {
        const box = el('div', 'formula');
        for (const line of block.formula) {
          const muted = typeof line === 'object' && line.muted;
          box.append(el('span', 'formula-line' + (muted ? ' is-secondary' : ''),
            typeof line === 'string' ? line : line.text));
        }
        body.append(box);
      }
    }
    if (sec.link) navRow(body, sec.link[0], sec.link[1], 'rules');
  }
  backRow(body);
}


/* ---------------- screens ---------------- */

function show(name) {
  for (const id of ['career', 'table', 'result']) {
    $('#screen-' + id).hidden = id !== name;
  }
}

/* ---------------- boot ---------------- */

bindControls();
$('#btnMenu').onclick = () => openModal('menu', { root: true });
$('#btnHelp').onclick = () => openModal('help', { root: true });
$('#btnOdds').onclick = () => openModal('odds', { root: true });
$('#btnModalClose').onclick = closeModal;
$('#modal').addEventListener('click', (e) => { if (e.target === $('#modal')) closeModal(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModal(); });
$('#btnContinue').onclick = () => renderCareer();
$('#btnStake').onclick = () => {
  save.bankroll += 50;
  save.staked++;
  writeSave(save);
  renderCareer();
};
// Five taps on the name, close together. No cursor change, no outline, nothing to
// find by hovering. Pays once, then needs a tournament played before it pays again.
const finds = {};
function secretTap(el, amount, title) {
  el.addEventListener('click', () => {
    const now = Date.now();
    const key = el.id;
    finds[key] = (finds[key] || []).filter(t => now - t < 2500);
    finds[key].push(now);
    if (finds[key].length < 5) return;
    finds[key] = [];
    save.bankroll += amount;
    writeSave(save);
    renderCareer();
    showTreasure(amount, title);
  });
}
secretTap($('#secretSpot'), 50, 'Buried Treasure Found');

function showPortrait(key, name) {
  $('#portraitImg').src = portraitSrc(key);
  $('#portraitImg').alt = name;
  $('#portraitName').textContent = name;
  $('#portrait').hidden = false;
}
$('#portrait').addEventListener('click', () => { $('#portrait').hidden = true; });

function showTreasure(amount, title) {
  const box = $('#treasure');
  $('#treasureTitle').textContent = title;
  $('#treasureSum').textContent = '+' + money(amount);
  box.classList.remove('is-going');
  box.hidden = false;
  clearTimeout(showTreasure.timer);
  showTreasure.timer = setTimeout(() => {
    box.classList.add('is-going');
    setTimeout(() => { box.hidden = true; box.classList.remove('is-going'); }, 400);
  }, 3000);
}

// Achievements earned during a hand queue up and are shown one at a time, after the
// pot has been settled rather than in the middle of the action.
async function flushAchievements() {
  while (pendingAchievements.length) {
    const id = pendingAchievements.shift();
    const meta = ACHIEVEMENTS.find(a => a.id === id);
    if (!meta) continue;
    await showUnlocked(meta.name);
  }
}

function showUnlocked(name) {
  const box = $('#unlocked');
  $('#unlockedName').textContent = name;
  box.classList.remove('is-going');
  box.hidden = false;
  return new Promise((resolve) => {
    setTimeout(() => {
      box.classList.add('is-going');
      setTimeout(() => {
        box.hidden = true;
        box.classList.remove('is-going');
        resolve();
      }, 400);
    }, 3000);
  });
}

$('#btnAchievements').onclick = () => openModal('achievements', { root: true });
$('#btnCareerStats').onclick = () => openModal('stats', { root: true });
$('#btnCareerOpponents').onclick = () => openModal('opponents', { root: true });
$('#btnCareerGuide').onclick = () => openModal('rules', { root: true });
$('#btnSettings').onclick = () => openModal('settings', { root: true });

renderCareer();

// Service workers need a secure context; the standalone file:// build simply skips it.
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => {});
    // Without this the browser may clear the cache and the save when space runs
    // short. Granted silently once the game is installed or used regularly.
    if (navigator.storage && navigator.storage.persist) {
      navigator.storage.persisted()
        .then((already) => (already ? true : navigator.storage.persist()))
        .catch(() => {});
    }
  });
}
