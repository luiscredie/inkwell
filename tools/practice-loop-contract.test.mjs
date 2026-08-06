// M2.5 Practice Loop contract (deterministic, no deps).
//   node tools/practice-loop-contract.test.mjs
import fs from 'node:fs';
import assert from 'node:assert/strict';

const html = fs.readFileSync(new URL('../site/index.html', import.meta.url), 'utf8');
let passed = 0;
const check = (name, fn) => { fn(); passed++; console.log('✓', name); };

function lift(startMarker, fnName, scope) {
  const s = html.indexOf(startMarker);
  assert.ok(s > 0, fnName + ' source not found');
  let i = html.indexOf('{', s), depth = 0, end = -1;
  for (; i < html.length; i++) {
    if (html[i] === '{') depth++;
    else if (html[i] === '}') { depth--; if (depth === 0) { end = i + 1; break; } }
  }
  assert.ok(end > s, fnName + ' braces unbalanced');
  const src = html.slice(s, end).replace(/^static\s+/, '').replace(new RegExp('^' + fnName), 'function ' + fnName);
  const names = Object.keys(scope || {});
  return Function(...names, `${src}; return ${fnName};`)(...names.map(n => scope[n]));
}

const matchMoments = lift('matchMoments(match){', 'matchMoments');
const mulliganScore = lift('mulliganScore(hand){', 'mulliganScore');
const weekKey = lift('weekKey(d){', 'weekKey');
const weeklyGoals = lift('weeklyGoals(){', 'weeklyGoals');
const matchupKey = lift('matchupKey(inks){', 'matchupKey');
const matchupNotebook = lift('matchupNotebook(){', 'matchupNotebook');
const simulateReplay = lift('simulateReplay(events, idx){', 'simulateReplay');

// ---------- harness ----------
const CARDS = [
  { card_id: 'a', name_en: 'Ally', card_type: 'Character', strength: 3, willpower: 3, ink_cost: 3, inkable: 1 },
  { card_id: 'b', name_en: 'Brute', card_type: 'Character', strength: 5, willpower: 5, ink_cost: 6, inkable: 0 },
  { card_id: 'c', name_en: 'Cheap', card_type: 'Character', strength: 1, willpower: 2, ink_cost: 1, inkable: 1 }
];
function ctx(over) {
  const byId = {}; for (const c of CARDS) byId[c.card_id] = c;
  return Object.assign({
    cards: CARDS, byId,
    state: { matches: [], decks: [], matchupNotes: {}, goalProgress: null },
    nameKey(n) { return String(n || '').toLowerCase().trim(); },
    cardByName(n) { return CARDS.find(c => this.nameKey(c.name_en) === this.nameKey(n)) || null; },
    cardKeywordMods() { return []; },
    youPlayerOf() { return 1; },
    wrColor() { return '#fff'; },
    t(k, p) { return p ? k + ':' + JSON.stringify(p) : k; },
    signed(n) { return (n > 0 ? '+' : '') + n; },
    simulateReplay, matchMoments, mulliganScore, weekKey, weeklyGoals, matchupKey, matchupNotebook
  }, over || {});
}
const ev = (...lines) => ({ replay: { events: lines.map(text => ({ text })) } });

// ---------- 1. moments need a real replay ----------
check('a match with no replay yields no moments', () => {
  assert.equal(matchMoments.call(ctx(), { replay: null }), null);
  assert.equal(matchMoments.call(ctx(), ev('Player 1 turn begins')), null);
});
check('a replay with a single turn yields no moments', () => {
  assert.equal(matchMoments.call(ctx(), ev("Player 1's turn begins", 'Player 1 played Ally (cost 3)')), null);
});

// ---------- 2. lore swing ----------
const loreMatch = ev(
  "Player 1's turn begins",
  'Player 1 played Ally (cost 3)',
  "Player 2's turn begins",
  'Player 2 quested with Brute (2 -> 6)',
  "Player 1's turn begins"
);
check('a large lore change is flagged as a lore moment', () => {
  const M = matchMoments.call(ctx(), loreMatch);
  assert.ok(M, 'expected moments');
  const lore = M.all.flatMap(m => m.kinds).filter(k => k.kind === 'lore');
  assert.equal(lore.length >= 1, true);
});
check('a lore moment favouring the opponent is marked against you', () => {
  const M = matchMoments.call(ctx(), loreMatch);
  const k = M.all.flatMap(m => m.kinds).find(x => x.kind === 'lore');
  assert.equal(k.favor, 'opp');
});
check('the lead changing hands is reported', () => {
  const flip = ev(
    "Player 1's turn begins",
    'Player 1 quested with Ally (0 -> 5)',
    "Player 2's turn begins",
    'Player 2 quested with Brute (0 -> 9)',
    "Player 1's turn begins"
  );
  const M = matchMoments.call(ctx(), flip);
  const detail = M.all.flatMap(m => m.kinds).map(k => k.detail).join(' ');
  assert.match(detail, /pmLoreFlip/);
});

// ---------- 3. economy ----------
check('a large ink difference in one turn is flagged', () => {
  const econ = ev(
    "Player 1's turn begins",
    'Player 1 played Brute (cost 6)',
    "Player 2's turn begins",
    'Player 2 played Cheap (cost 1)',
    "Player 1's turn begins"
  );
  const M = matchMoments.call(ctx(), econ);
  const k = M.all.flatMap(x => x.kinds).find(x => x.kind === 'econ');
  assert.ok(k, 'expected an economy moment');
  assert.match(k.detail, /pmEconDetail/);
});

// ---------- 4. board ----------
check('losing characters is reported as a board moment', () => {
  const board = ev(
    "Player 1's turn begins",
    'Player 1 played Brute (cost 6)',
    "Player 2's turn begins",
    'Brute was banished',
    "Player 1's turn begins"
  );
  const M = matchMoments.call(ctx(), board);
  // turn 1 gains you a character; turn 2 loses it. Both are board moments with
  // opposite sign, so assert per turn rather than taking the first hit.
  const t1 = M.all.find(m => m.turn === 1).kinds.find(k => k.kind === 'board');
  const t2 = M.all.find(m => m.turn === 2).kinds.find(k => k.kind === 'board');
  assert.ok(t1 && t2, 'expected a board moment on both turns');
  assert.equal(t1.favor, 'you', 'landing a character favours you');
  assert.equal(t2.favor, 'opp', 'losing that character favours the opponent');
  assert.match(t2.detail, /pmBoardDetail/);
});

// ---------- 5. moments are descriptive, never prescriptive ----------
check('no moment string carries advice vocabulary', () => {
  const s = html.indexOf('pmBoardDetail:');
  const block = html.slice(s - 2000, s + 2000);
  for (const word of ['should have', 'consider ', 'try to ', 'deveria', 'considere']) {
    assert.equal(block.includes(word), false, 'found prescriptive wording: ' + word);
  }
});
check('the no-hidden-information caveat is shown to the player', () => {
  assert.match(html, /\{\{ pmNote \}\}/);
  assert.equal((html.match(/pmNote:/g) || []).length, 2);
});

// ---------- 6. top three ----------
check('at most three moments are highlighted, in turn order', () => {
  const many = ev(
    "Player 1's turn begins", 'Player 1 quested with Ally (0 -> 4)',
    "Player 2's turn begins", 'Player 2 quested with Brute (0 -> 5)',
    "Player 1's turn begins", 'Player 1 quested with Ally (4 -> 9)',
    "Player 2's turn begins", 'Player 2 quested with Brute (5 -> 11)',
    "Player 1's turn begins", 'Player 1 quested with Ally (9 -> 15)',
    "Player 2's turn begins"
  );
  const M = matchMoments.call(ctx(), many);
  assert.ok(M.top.length <= 3);
  const turns = M.top.map(m => m.turn);
  assert.deepEqual(turns, turns.slice().sort((a, b) => a - b), 'top moments must read in turn order');
});
check('each moment points at an event index inside the replay', () => {
  const M = matchMoments.call(ctx(), loreMatch);
  for (const m of M.all) {
    assert.equal(Number.isInteger(m.index), true);
    assert.equal(m.index >= 0 && m.index < loreMatch.replay.events.length, true);
  }
});

// ---------- 7. mulligan scoring ----------
const hand = (costs, inkables) => costs.map((cost, i) => ({
  name: 'C' + i, cost, inkable: inkables ? !!inkables[i] : cost <= 3, role: 'x', keep: true, advice: 'earlyPlay'
}));

check('an empty hand scores nothing rather than crashing', () => {
  assert.equal(mulliganScore.call(ctx(), []), null);
  assert.equal(mulliganScore.call(ctx(), null), null);
});
check('a curve-light hand with ink is a keep', () => {
  const r = mulliganScore.call(ctx(), hand([1, 2, 3, 3, 4, 5, 6]));
  assert.equal(r.verdict, 'keep');
  assert.equal(r.early, 4);
  assert.equal(r.score > 50, true);
});
check('an all-expensive hand is a mulligan', () => {
  const r = mulliganScore.call(ctx(), hand([6, 6, 7, 7, 8, 8, 9]));
  assert.equal(r.verdict, 'mulligan');
  assert.equal(r.early, 0);
  assert.equal(r.score < 40, true);
});
check('early plays without inkable cards is still a mulligan', () => {
  const r = mulliganScore.call(ctx(), hand([1, 2, 2, 3, 4, 5, 6], [0, 0, 0, 0, 0, 0, 0]));
  assert.equal(r.inkable, 0);
  assert.equal(r.verdict, 'mulligan', 'a hand you cannot ink is not keepable');
});
check('the score stays inside 0-100', () => {
  for (const h of [hand([1, 1, 1, 1, 1, 1, 1]), hand([9, 9, 9, 9, 9, 9, 9])]) {
    const r = mulliganScore.call(ctx(), h);
    assert.equal(r.score >= 0 && r.score <= 100, true);
  }
});
check('scoring reports its factors so the number is not a black box', () => {
  const r = mulliganScore.call(ctx(), hand([1, 2, 3, 4, 5, 6, 7]));
  assert.equal(r.factors.length, 4);
  for (const f of r.factors) { assert.ok(f.label); assert.ok(f.value !== undefined); }
});
check('the scoring caveat is shown to the player', () => {
  assert.match(html, /\{\{ mullBasis \}\}/);
  assert.equal((html.match(/mlBasis:/g) || []).length, 2);
});

// ---------- 8. weekly goals ----------
check('the week key is a Monday and is stable within a week', () => {
  const mon = weekKey.call(ctx(), '2026-08-03T12:00:00');
  const wed = weekKey.call(ctx(), '2026-08-05T23:00:00');
  const sun = weekKey.call(ctx(), '2026-08-09T09:00:00');
  assert.equal(mon, wed);
  assert.equal(mon, sun);
  assert.equal(new Date(mon + 'T00:00:00').getDay(), 1, 'week must start on Monday');
});
check('the next Monday starts a new week', () => {
  const a = weekKey.call(ctx(), '2026-08-09T23:59:00');
  const b = weekKey.call(ctx(), '2026-08-10T00:01:00');
  assert.notEqual(a, b);
});
check('progress from a previous week does not carry over', () => {
  const c = ctx();
  c.state.goalProgress = { week: '2020-01-06', reviewed: { m1: 1, m2: 1 }, mulligans: 99 };
  const g = weeklyGoals.call(c);
  assert.equal(g.goals.find(x => x.id === 'review').done, 0);
  assert.equal(g.goals.find(x => x.id === 'mull').done, 0);
});
check('progress within the current week counts', () => {
  const c = ctx();
  c.state.goalProgress = { week: weekKey.call(c), reviewed: { m1: 1 }, mulligans: 2 };
  const g = weeklyGoals.call(c);
  assert.equal(g.goals.find(x => x.id === 'review').done, 1);
  assert.equal(g.goals.find(x => x.id === 'mull').done, 2);
});
check('goal progress never exceeds its target', () => {
  const c = ctx();
  c.state.goalProgress = { week: weekKey.call(c), reviewed: {}, mulligans: 500 };
  const g = weeklyGoals.call(c).goals.find(x => x.id === 'mull');
  assert.equal(g.done, g.target);
  assert.equal(g.pct, 100);
});
check('only matches logged this week count toward the logging goal', () => {
  const c = ctx();
  c.state.matches = [{ date: new Date().toISOString() }, { date: '2019-01-01T00:00:00Z' }, { date: 'not a date' }];
  assert.equal(weeklyGoals.call(c).goals.find(x => x.id === 'log').done, 1);
});

// ---------- 9. matchup notebook ----------
check('matchups are keyed by ink colours, order-independent', () => {
  const c = ctx();
  assert.equal(matchupKey.call(c, ['Amber', 'Steel']), matchupKey.call(c, ['Steel', 'Amber']));
  assert.equal(matchupKey.call(c, []), '__unknown');
  assert.equal(matchupKey.call(c, null), '__unknown');
});
check('the notebook aggregates a record per matchup', () => {
  const c = ctx();
  c.state.matches = [
    { opponent_inks: ['Amber', 'Steel'], result: 'win' },
    { opponent_inks: ['Steel', 'Amber'], result: 'loss' },
    { opponent_inks: ['Ruby'], result: 'win' }
  ];
  const nb = matchupNotebook.call(c);
  const amber = nb.find(x => x.key === 'Amber/Steel');
  assert.equal(amber.n, 2);
  assert.equal(amber.w, 1);
  assert.equal(amber.l, 1);
  assert.equal(amber.wr, 50);
  assert.equal(nb.length, 2);
});
check('a matchup with a note but no games still appears', () => {
  const c = ctx();
  c.state.matchupNotes = { 'Ruby/Sapphire': { text: 'watch the bounce' } };
  const nb = matchupNotebook.call(c);
  const row = nb.find(x => x.key === 'Ruby/Sapphire');
  assert.ok(row, 'a written note must never be orphaned');
  assert.equal(row.n, 0);
  assert.equal(row.wr, null, 'no games means no win rate, not 0%');
  assert.equal(row.note, 'watch the bounce');
});
check('notes are stored per matchup and clearing removes the entry', () => {
  const s = html.indexOf('setMatchupNote(key,text){');
  const body = html.slice(s, html.indexOf('\n  // ---- M1.9', s));
  assert.match(body, /\{\.\.\.\(this\.state\.matchupNotes\|\|\{\}\)\}/);
  assert.match(body, /else delete notes\[key\]/);
  assert.match(body, /this\.saveLocal\(\)/);
});

// ---------- 10. persistence ----------
check('practice-loop state is saved and migrated, not dropped', () => {
  assert.match(html, /matchupNotes:this\.state\.matchupNotes\|\|\{\}/);
  assert.match(html, /goalProgress:this\.state\.goalProgress\|\|null/);
  assert.match(html, /d\.matchupNotes = \(d\.matchupNotes && typeof d\.matchupNotes==='object'\)/);
  assert.match(html, /d\.goalProgress = /);
});

// ---------- 11. UI wiring ----------
check('moments render in Match Center, notebook and goals in Academy', () => {
  const mcStart = html.indexOf('<sc-if value="{{ isMatches }}"');
  const mcEnd = html.indexOf('<sc-if value="{{ isLearn }}"');
  const mc = html.slice(mcStart, mcEnd);
  const learn = html.slice(mcEnd, mcEnd + 20000);
  assert.match(mc, /list="\{\{ pmMoments \}\}"/, 'moments belong in Match Center');
  assert.match(learn, /list="\{\{ wgGoals \}\}"/, 'goals belong in Academy');
  assert.match(learn, /list="\{\{ nbRows \}\}"/, 'notebook belongs in Academy');
  assert.match(learn, /list="\{\{ mullCards \}\}"/, 'mulligan lab belongs in Academy');
  assert.doesNotMatch(mc, /list="\{\{ nbRows \}\}"/);
});
check('the score only appears after the player commits to a decision', () => {
  assert.match(html, /V\.mullHasScore=!!\(MS&&st\.mullChoice\)/);
});
check('drawing a hand counts toward the weekly goal', () => {
  assert.match(html, /this\.noteMulliganRun\(\);\s*this\.setState\(\{mullHand/);
});
check('jumping to a moment counts as reviewing that match', () => {
  assert.match(html, /this\.noteMatchReviewed\(selected\.id\)/);
});
check('interactive controls meet the 44px touch target', () => {
  const s = html.indexOf('list="{{ mullCards }}"');
  const block = html.slice(s - 3000, s + 4000);
  assert.equal((block.match(/min-height:44px/g) || []).length >= 3, true);
});
check('every new key exists in EN and PT', () => {
  for (const k of ['pmTitle', 'pmSub', 'pmNote', 'pmShowAll', 'pmShowTop', 'pmTurn', 'pmJump', 'pmBoard', 'pmLore',
    'pmEcon', 'pmBoardDetail', 'pmLoreDetail', 'pmLoreFlip', 'pmEconDetail', 'acGoals', 'acNotebook', 'acMull',
    'wgTitle', 'wgSub', 'wgReset', 'wgLog', 'wgReview', 'wgMull', 'nbTitle', 'nbSub', 'nbEmptyMsg', 'nbPlaceholder',
    'nbGames', 'mlTitle', 'mlSub', 'mlNoDeck', 'mlDraw', 'mlRedraw', 'mlKeep', 'mlMulligan', 'mlEarly', 'mlInkable',
    'mlExpensive', 'mlAvg', 'mlVerdictKeep', 'mlVerdictMull', 'mlAgree', 'mlDiffer', 'mlBasis',
    'mv_earlyPlay', 'mv_inkFuel', 'mv_tooExpensive', 'mv_situational']) {
    assert.equal((html.match(new RegExp(k + ':', 'g')) || []).length, 2, k);
  }
});

// ---------- 12. mirror ----------
check('site/index.html and Inkwell.dc.html stay byte-identical', () => {
  assert.equal(html, fs.readFileSync(new URL('../Inkwell.dc.html', import.meta.url), 'utf8'));
});

console.log(`\n${passed} passed`);
