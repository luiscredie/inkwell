// V14 Replay / Inkability / Wishlist contract (deterministic, no deps).
//   node tools/replay-ux-contract.test.mjs
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

const replayChapters = lift('replayChapters(events){', 'replayChapters');
const wishlistRows = lift('wishlistRows(){', 'wishlistRows');
const setWishTarget = lift('setWishTarget(id,raw){', 'setWishTarget');
const wishTarget = lift('wishTarget(id){', 'wishTarget');

const ev = (...lines) => lines.map(text => ({ text }));

// ---------- chapters ----------
check('an empty replay has no chapters rather than throwing', () => {
  assert.deepEqual(replayChapters([]), []);
  assert.deepEqual(replayChapters(null), []);
});
check('each turn marker becomes one chapter, numbered from 1', () => {
  const c = replayChapters(ev(
    "Player 1's turn begins", 'Player 1 played Ally (cost 3)',
    "Player 2's turn begins", 'Player 2 quested with Brute (0 -> 2)',
    "Player 1's turn begins"
  ));
  assert.equal(c.length, 3);
  assert.deepEqual(c.map(x => x.turn), [1, 2, 3]);
  assert.deepEqual(c.map(x => x.player), [1, 2, 1]);
});
check('a chapter spans up to the event before the next one', () => {
  const c = replayChapters(ev(
    "Player 1's turn begins", 'a', 'b',
    "Player 2's turn begins", 'c'
  ));
  assert.equal(c[0].index, 0);
  assert.equal(c[0].end, 2, 'first chapter ends just before the next turn');
  assert.equal(c[1].index, 3);
});
check('the last chapter runs to the end of the log', () => {
  const events = ev("Player 1's turn begins", 'a', 'b', 'c');
  const c = replayChapters(events);
  assert.equal(c[c.length - 1].end, events.length - 1);
});
check('You/Opponent phrasing is read as well as Player N', () => {
  const c = replayChapters(ev('Your turn begins', 'x', "Opponent's turn begins"));
  assert.equal(c.length, 2);
  assert.deepEqual(c.map(x => x.player), [1, 2]);
});
check('chapter ranges are contiguous and never overlap', () => {
  const c = replayChapters(ev(
    "Player 1's turn begins", 'a', "Player 2's turn begins", 'b', 'c', "Player 1's turn begins", 'd'
  ));
  for (let i = 1; i < c.length; i++) {
    assert.equal(c[i].index, c[i - 1].end + 1, 'chapter ' + i + ' must start right after the previous one ends');
  }
});

// ---------- regression: "Your turn begins" crashed the replay ----------
// V14 widened the turn regex to accept "Your" but left the P() helper knowing only
// "You", so P('Your') was NaN and S[NaN].inkExert threw on the first turn marker —
// a red error box instead of the app.
check('a "Your turn begins" log simulates instead of throwing', () => {
  const simulate = lift('simulateReplay(events, idx){', 'simulateReplay', {
    React: { createElement() { return null; } }
  });
  const ctx = {
    cardByName() { return null; },
    cardKeywordMods() { return []; },
    simulateReplay: simulate
  };
  const events = ev('Your turn begins', 'You added Ally to ink', "Opponent's turn begins");
  const out = simulate.call(ctx, events, events.length - 1);
  assert.ok(out && out.S, 'a result must come back');
  assert.equal(out.S[1].inkTotal, 1, 'the ink went to player 1, not into a void');
});
check('an unrecognised actor costs one event, not the whole replay', () => {
  const simulate = lift('simulateReplay(events, idx){', 'simulateReplay', {
    React: { createElement() { return null; } }
  });
  const ctx = { cardByName() { return null; }, cardKeywordMods() { return []; }, simulateReplay: simulate };
  const events = ev('Player 7 turn begins', "Player 1's turn begins", 'Player 1 added Ally to ink');
  const out = simulate.call(ctx, events, events.length - 1);
  assert.ok(out && out.S, 'the view must survive a nonsense actor');
  assert.equal(out.S[1].inkTotal, 1, 'the valid events still apply');
});
check('the player helper never yields NaN', () => {
  assert.ok(html.includes('return (p===1||p===2)?p:null;'), 'P must reject anything but 1 or 2');
  assert.ok(html.includes('const slot=(p)=>(p===1||p===2)?S[p]:SINK;'), 'a sink slot must absorb unknown actors');
  assert.equal((html.match(new RegExp(String.raw`S\[P\([^)]*\)\]\.\w+\s*=`, 'g')) || []).length, 0,
    'no write may index S with an unchecked player');
});

// ---------- timeline UI ----------
check('the timeline is a real range input bound to the replay index', () => {
  assert.match(html, /type="range"[^>]*max="\{\{ tlMax \}\}"[^>]*value="\{\{ tlValue \}\}"[^>]*onChange="\{\{ tlSeek \}\}"/);
});
check('turn chapters and moment markers both render on the timeline', () => {
  assert.match(html, /list="\{\{ tlChapters \}\}"/);
  assert.match(html, /list="\{\{ tlMarkers \}\}"/);
});
check('moment markers are buttons, so they can be clicked to seek', () => {
  const s = html.indexOf('list="{{ tlMarkers }}"');
  const block = html.slice(s, s + 600);
  assert.match(block, /<button/, 'markers must be focusable buttons, not decorative divs');
  assert.match(block, /aria-label=/, 'a marker needs an accessible name');
});
check('speed control offers three rates and drives replaySpeedSet', () => {
  assert.match(html, /list="\{\{ tlSpeeds \}\}"/);
  assert.match(html, /replaySpeedSet\s*=/);
  assert.match(html, /replayTickMs\(\)\{ const s=this\.state\.replaySpeed\|\|1; return Math\.round\(850\/s\); \}/);
});
check('changing speed while playing restarts the timer at the new rate', () => {
  const s = html.indexOf('replaySpeedSet = (v)=>{');
  const body = html.slice(s, s + 260);
  assert.match(body, /if\(this\.state\.replayPlaying\)\{ this\.stopReplayTimer\(\);/);
});
check('seeking stops playback so the scrub does not fight the timer', () => {
  assert.match(html, /replaySeek = \(i\)=>\{ this\.stopReplayTimer\(\); this\.setState\(\{replayIndex:Math\.max\(0,i\), replayPlaying:false\}\)/);
});

// ---------- board readability ----------
check('both hands, ink pips and the live event are on the board', () => {
  for (const hole of ['rf.youHand', 'rf.oppHand', 'rf.youInkPips', 'rf.oppInkPips', 'rf.eventText']) {
    assert.ok(html.includes('{{ ' + hole + ' }}') || html.includes('list="{{ ' + hole + ' }}"'), 'missing ' + hole);
  }
});
check('ink is shown as available-over-total, not just a total', () => {
  assert.match(html, /youInkText:\(SS\[yp\]\.inkTotal-SS\[yp\]\.inkExert\)\+'\/'\+SS\[yp\]\.inkTotal/);
});
check('exerted and drying characters are visually distinct', () => {
  assert.match(html, /ch\.exerted\?'transform:rotate\(90deg\)/);
  assert.match(html, /stateColor:ch\.drying\?'var\(--info\)'/);
});
check('the opponent hand stays masked until hidden info is revealed', () => {
  assert.match(html, /const hideOpp=!st\.replayShowHidden;/);
  assert.match(html, /oppHand:SS\[op\]\.hand\.map\(n=>handTile\(n,hideOpp\)\)/);
  assert.match(html, /youHand:SS\[yp\]\.hand\.map\(n=>handTile\(n,false\)\)/);
});
check('the board is still labelled an estimate', () => {
  assert.match(html, /estimatedLabel:this\.t\('mcEstimated'\)/);
  assert.match(html, /exact:false/);
});

// ---------- inkability ----------
check('the inkability panel is not hidden behind deck warnings', () => {
  const s = html.indexOf('<sc-if value="{{ dd.hasHealth }}"');
  assert.ok(s > 0, 'the health card must render on its own condition');
  const inkAt = html.indexOf('{{ dd.ink.title }}');
  const warnAt = html.indexOf('{{ dd.health.warnings }}');
  assert.ok(inkAt > s && inkAt < warnAt, 'inkability sits inside the health card, above the warnings');
  assert.doesNotMatch(html, /<sc-if value="\{\{ dd\.health\.hasWarnings \}\}"/,
    'the card must no longer be gated on there being warnings');
});
check('a healthy deck gets a positive line instead of an empty card', () => {
  assert.match(html, /\{\{ dd\.health\.okLabel \}\}/);
  assert.match(html, /<sc-if value="\{\{ dd\.health\.ok \}\}"/);
});
check('inkability thresholds are ordered and colour-coded', () => {
  assert.match(html, /color:H\.inkablePct>=55\?'var\(--ok\)':\(H\.inkablePct>=45\?'var\(--warn\)':'var\(--err\)'\)/);
});
check('the percentage and the bar come from the same number', () => {
  assert.match(html, /pctText:H\.inkablePct\+'%', barWidth:H\.inkablePct\+'%'/);
});

// ---------- wishlist ----------
function wctx(over) {
  return Object.assign({
    cards: [], byId: {},
    state: { wishlist: {}, collection: {} },
    prices: {},
    nameKey(n) { return String(n || '').toLowerCase().trim(); },
    priceOr0() { return 0; },
    fmt(v) { return 'R$ ' + Number(v || 0).toFixed(2).replace('.', ','); },
    t(k, p) { return p ? k + ':' + JSON.stringify(p) : k; },
    setState(patch) { Object.assign(this.state, patch); },
    saveLocal() {},
    wishlistRows, setWishTarget, wishTarget
  }, over || {});
}

check('an empty wishlist yields no rows', () => {
  assert.deepEqual(wishlistRows.call(wctx()), []);
});
check('a target above the market price registers as a hit', () => {
  const c = wctx({
    cards: [{ card_id: 'a', name_en: 'Ally' }],
    byId: { a: { card_id: 'a', name_en: 'Ally' } },
    state: { wishlist: { a: { t: 20 } }, collection: {} },
    priceOr0() { return 15; }
  });
  const rows = wishlistRows.call(c);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].hit, true, 'market 15 is at or under the 20 target');
});
check('a target below the market price is not a hit and reports the gap', () => {
  const c = wctx({
    cards: [{ card_id: 'a', name_en: 'Ally' }],
    byId: { a: { card_id: 'a', name_en: 'Ally' } },
    state: { wishlist: { a: { t: 10 } }, collection: {} },
    priceOr0() { return 20; }
  });
  const r = wishlistRows.call(c)[0];
  assert.equal(r.hit, false);
  assert.ok(r.gap != null && r.gap > 0, 'the gap to the target must be reported');
});
check('a wishlist entry with no target is listed without a verdict', () => {
  const c = wctx({
    cards: [{ card_id: 'a', name_en: 'Ally' }],
    byId: { a: { card_id: 'a', name_en: 'Ally' } },
    state: { wishlist: { a: 1 }, collection: {} },
    priceOr0() { return 20; }
  });
  const r = wishlistRows.call(c)[0];
  assert.equal(r.target, null);
  assert.equal(r.hit, false, 'no target cannot be a hit');
});
check('a comma decimal is accepted as a target', () => {
  const c = wctx({ state: { wishlist: { a: 1 }, collection: {} } });
  setWishTarget.call(c, 'a', '12,50');
  assert.deepEqual(c.state.wishlist.a, { t: 12.5 }, 'Brazilian decimal comma must parse');
});
check('clearing the field drops the target but keeps the card wishlisted', () => {
  const c = wctx({ state: { wishlist: { a: { t: 12.5 } }, collection: {} } });
  setWishTarget.call(c, 'a', '');
  assert.equal(c.state.wishlist.a, 1, 'the card stays wishlisted, just untargeted');
});
check('a nonsense target never becomes NaN', () => {
  const c = wctx({ state: { wishlist: { a: 1 }, collection: {} } });
  setWishTarget.call(c, 'a', 'abc');
  const e = c.state.wishlist.a;
  assert.ok(e === 1 || Number.isFinite(e.t), 'must never store NaN');
});
check('targets round to cents rather than carrying float noise', () => {
  const c = wctx({ state: { wishlist: { a: 1 }, collection: {} } });
  setWishTarget.call(c, 'a', '12,999');
  assert.equal(c.state.wishlist.a.t, 13);
});
check('the legacy bookmark value stays truthy so old wishlists survive', () => {
  const c = wctx({ state: { wishlist: { a: 1 }, collection: {} } });
  assert.equal(wishTarget.call(c, 'a'), null, 'a legacy entry has no target');
  assert.ok(c.state.wishlist.a, 'but it is still on the wishlist');
});
check('the target rides inside the wishlist entry, so it syncs with the profile', () => {
  assert.match(html, /wishlist:this\.state\.wishlist/);
});

// ---------- i18n ----------
check('every new key exists in EN and PT', () => {
  for (const k of ['rpSpeed', 'rpHand', 'rpInk', 'rpExerted', 'rpReady', 'rpDrying',
    'inkTitle', 'inkInkable', 'inkNotInkable', 'inkNote', 'inkHealthy',
    'wlTitle', 'wlTarget', 'wlPrice', 'wlHit', 'wlPlaceholder']) {
    assert.equal((html.match(new RegExp('\\b' + k + ':', 'g')) || []).length, 2, k);
  }
});

// ---------- mirror ----------
check('site/index.html and Inkwell.dc.html stay byte-identical', () => {
  assert.equal(html, fs.readFileSync(new URL('../Inkwell.dc.html', import.meta.url), 'utf8'));
});

console.log(`\n${passed} passed`);
