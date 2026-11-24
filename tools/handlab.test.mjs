// Mão de teste e mulligan (src/site/handlab.js): rules (Comprehensive Rules 2.3.0, 2.2.2) and exact probabilities.
// Run: node tools/handlab.test.mjs
import fs from 'node:fs';
import vm from 'node:vm';

const ctx = { window: {} }; vm.createContext(ctx);
vm.runInContext(fs.readFileSync(new URL('../src/site/handlab.js', import.meta.url), 'utf8'), ctx);
const H = ctx.window.INKWELL_HANDLAB;

let ok = 0, bad = 0;
const t = (name, cond, detail = '') => { if (cond) ok++; else { bad++; console.log(`✗ ${name}${detail ? ': ' + detail : ''}`); } };
const near = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// a 60-card deck: 15 cards × 4. Card info: cost and inkable by id
const CARDS = Object.fromEntries(Array.from({ length: 15 }, (_, i) => [`C${String(i + 1).padStart(2, '0')}`, 4]));
const INFO = (id) => { const n = +id.slice(1); return { known: true, cost: ((n - 1) % 8) + 1, inkable: n % 3 !== 0 }; };
const uids = (l) => l.map((c) => c.uid);

// ---------- instances and dealing ----------
{
  const inst = H.instances(CARDS);
  t('one instance per copy', inst.length === 60);
  t('instance ids are unique', new Set(uids(inst)).size === 60);
  t('4 copies → 4 instances of the same card', inst.filter((c) => c.id === 'C01').length === 4 && eq(inst.filter((c) => c.id === 'C01').map((c) => c.uid), ['C01#1', 'C01#2', 'C01#3', 'C01#4']));
  const d = H.deal(CARDS, 42);
  t('7 in hand', d.hand.length === 7);
  t('hand + library = the deck', d.hand.length + d.library.length === 60 && new Set(uids(d.hand.concat(d.library))).size === 60);
  t('same seed, same hand', eq(uids(H.deal(CARDS, 42).hand), uids(d.hand)));
  t('another seed, another hand', !eq(uids(H.deal(CARDS, 43).hand), uids(d.hand)));
  t('the deck list is only read', eq(CARDS, Object.fromEntries(Array.from({ length: 15 }, (_, i) => [`C${String(i + 1).padStart(2, '0')}`, 4]))));
  t('fewer than 7 cards: no hand', H.deal({ A: 3, B: 3 }, 1).error === 'small');
}

// ---------- the mulligan (2.2.2.1, 2.2.2.3) ----------
for (const k of [0, 1, 2, 3, 4, 5, 6, 7]) {
  const d = H.deal(CARDS, 1000 + k), back = uids(d.hand.slice(0, k)), m = H.mulligan(d, back);
  t(`return ${k}: final hand has 7`, m.final.length === 7);
  t(`return ${k}: returned cards are not among the replacements`, !m.drawn.some((c) => back.includes(c.uid)));
  t(`return ${k}: replacements are the top ${k} of the library`, eq(uids(m.drawn), uids(d.library.slice(0, k))));
  t(`return ${k}: total kept (hand + library = 60, no duplicate)`, m.final.length + m.library.length === 60 && new Set(uids(m.final.concat(m.library))).size === 60);
  t(`return ${k}: returned cards are in the library`, back.every((u) => m.library.some((c) => c.uid === u)));
  t(`return ${k}: kept cards stay`, eq(uids(m.kept), uids(d.hand.slice(k))));
  if (k === 0) t('return 0: no shuffle (library order unchanged)', eq(uids(m.library), uids(d.library)));
  else t(`return ${k}: the deck is shuffled after the draw (not left with the returned cards at the bottom)`, !eq(uids(m.library), uids(d.library.slice(k).concat(d.hand.slice(0, k)))));
}
{
  const d = H.deal({ A: 4, B: 3 }, 7), aCopies = d.hand.filter((c) => c.id === 'A');
  const m = H.mulligan(d, uids(aCopies.slice(0, 2)));
  t('two copies of one card: return two, keep the others', m.returned.length === 2 && m.kept.filter((c) => c.id === 'A').length === aCopies.length - 2);
  let threw = false; try { H.mulligan(m, []); } catch { threw = true; }
  t('only one mulligan per hand', threw);
  threw = false; try { H.mulligan(H.deal(CARDS, 3), ['C01#1', 'C01#1']); } catch { threw = true; }
  t('the same card cannot go back twice', threw);
  threw = false; try { const d2 = H.deal(CARDS, 3); H.mulligan(d2, [d2.library[0].uid]); } catch { threw = true; }
  t('only cards in hand can go back', threw);
}
{ // a deck of 9: the top runs out, so the draw continues from the bottom — where the returned cards are
  const d = H.deal({ A: 5, B: 4 }, 5), back = uids(d.hand.slice(0, 4)), m = H.mulligan(d, back);
  t('small deck: the 2 library cards come first', eq(uids(m.drawn.slice(0, 2)), uids(d.library)));
  t('small deck: then the returned cards, from the bottom', eq(uids(m.drawn.slice(2)), back.slice(0, 2)));
  t('small deck: still 7 and 9', m.final.length === 7 && m.final.length + m.library.length === 9);
}

// ---------- shuffle has no bias (chi-square over 10 items × 10 positions, 20,000 shuffles) ----------
{
  const items = [...Array(10).keys()], cnt = items.map(() => Array(10).fill(0)), rand = H.rng(2026);
  const S = 20000; for (let s = 0; s < S; s++) H.shuffle(items, rand).forEach((v, pos) => cnt[v][pos]++);
  const e = S / 10; let chi = 0; for (const row of cnt) for (const o of row) chi += (o - e) ** 2 / e;
  // 90 degrees of freedom (10 rows × 9): mean 90, sd ≈ 13.4; 145 is far beyond the 99.9th percentile
  t('shuffle: every card in every position about equally often', chi < 145, `chi² = ${chi.toFixed(1)}`);
}

// ---------- probabilities: small cases checked by hand ----------
t('d(t): the starting player skips the turn-1 draw', H.drawsBy(1, 'first') === 0 && H.drawsBy(4, 'first') === 3 && H.drawsBy(1, 'second') === 1 && H.drawsBy(4, 'second') === 4);
// P2 with 3 of the kind among 10, none in hand: going first, 1 draw by turn 2 → 3/10; second, 2 draws → 1 − (7·6)/(10·9)
t('pAny going first = 3/10', near(H.pAny(0, 3, 10, H.drawsBy(2, 'first')), 0.3));
t('pAny second player = 48/90', near(H.pAny(0, 3, 10, H.drawsBy(2, 'second')), 48 / 90));
t('pAny with one in hand = 1', H.pAny(1, 0, 10, 0) === 1);
// P1, 1 inkable in hand, 2 of 4 left. Going first: turn 2 needs the 1st draw inkable (1/2), turn 3 the 2nd too (1/3) → 1/6;
// turn 4 would need 4 inkables but only 3 exist → 0.
t('P1 going first, to turn 3 = 1/6', near(H.pInkEachTurn(1, 2, 4, 'first', 3), 1 / 6));
t('P1 going first, to turn 4 = 0', near(H.pInkEachTurn(1, 2, 4, 'first', 4), 0));
// second player: turn 2 needs ≥1 inkable in 2 draws (5/6); turn 3 needs both among 3 draws (C(2,2)·C(2,1)/C(4,3) = 1/2), which implies turn 2
t('P1 second player, to turn 3 = 1/2', near(H.pInkEachTurn(1, 2, 4, 'second', 3), 0.5));
t('P1 second player, to turn 2 = 5/6', near(H.pInkEachTurn(1, 2, 4, 'second', 2), 5 / 6));
t('P1 with 4 inkables in hand = 1', H.pInkEachTurn(4, 0, 53, 'first') === 1);
t('hypergeometric weights add up to 1', near([0, 1, 2, 3].reduce((s, j) => s + H.hyper(5, 20, 3, j), 0), 1));
// expectation of inkables in the new hand: 2 in hand, 1 inkable goes back, 1 card comes from 4 with 1 inkable → 2 − 1 + 1/4
t('expectation by hand = 1.25', near(H.expectAfter((h) => h, 2, 1, 1, 4, 1), 1.25));

// ---------- the exact expectation of a decision agrees with a simulation ----------
{
  const ord = 'first', d = H.deal(CARDS, 77), back = uids(d.hand.filter((c) => INFO(c.id).cost >= 5));
  const a = H.analyze(H.mulligan(d, back), INFO, ord);
  // simulate the decision: the replacements are any k of the library, at random
  const S = 4000, rand = H.rng(99); let sum = 0;
  for (let s = 0; s < S; s++) {
    const lib = H.shuffle(d.library, rand), drawn = lib.slice(0, back.length), rest = lib.slice(back.length).concat(d.hand.filter((c) => back.includes(c.uid)));
    const hand = d.hand.filter((c) => !back.includes(c.uid)).concat(drawn);
    const ink = (l) => l.filter((c) => INFO(c.id).inkable).length;
    sum += H.pInkEachTurn(ink(hand), ink(rest), rest.length, ord);
  }
  t(`exact expectation = simulation (${back.length} returned)`, Math.abs(a.probs.expect.ink - sum / S) < 0.015, `${a.probs.expect.ink.toFixed(4)} vs ${(sum / S).toFixed(4)}`);
}

// ---------- analysis ----------
{
  let threw = false; try { H.analyze(H.deal(CARDS, 5), INFO, 'first'); } catch { threw = true; }
  t('no analysis before the decision', threw);
  const d = H.deal(CARDS, 11), kept0 = H.analyze(H.mulligan(d, []), INFO, 'first');
  t('keeping 7: the expectation is the keep value', eq(kept0.probs.expect, kept0.probs.keep) && kept0.decision === 'kept');
  t('keeping 7: the final hand is the original', eq(kept0.facts.final, kept0.facts.original));
  const second = H.analyze(H.mulligan(d, []), INFO, 'second');
  t('second player draws one more: never a lower chance', second.probs.keep.ink >= kept0.probs.keep.ink && second.probs.keep.early >= kept0.probs.keep.early);
  // facts by hand
  const hand = { hand: [{ uid: 'C08#1', id: 'C08' }, { uid: 'C08#2', id: 'C08' }, { uid: 'C06#1', id: 'C06' }, { uid: 'C01#1', id: 'C01' }, { uid: 'C02#1', id: 'C02' }, { uid: 'C03#1', id: 'C03' }, { uid: 'C05#1', id: 'C05' }] };
  // C08: cost 8, inkable; C06: cost 6, not inkable; C01: 1 ink; C02: 2 ink; C03: 3 not inkable; C05: 5 ink
  const st = { seed: 1, size: 60, hand: hand.hand, library: H.instances(CARDS).filter((c) => !hand.hand.some((h) => h.uid === c.uid)), mulled: false };
  const a = H.analyze(H.mulligan(st, ['C01#1', 'C02#1']), INFO, 'first');
  const f = a.facts.original;
  t('facts: inkable, cost 1–3, high, high not inkable', f.inkable === 5 && f.cost1to3 === 3 && eq(f.byCost, [1, 1, 1]) && f.high === 4 && f.highUninkable === 1, JSON.stringify(f));
  t('facts: average cost', near(f.avg, (8 + 8 + 6 + 1 + 2 + 3 + 5) / 7));
  const codes = a.notes.map((n) => n.code);
  t('note: kept a high card that is not inkable (C06)', codes.includes('keptHighUninkable') && a.notes.find((n) => n.code === 'keptHighUninkable').uids.join() === 'C06#1');
  t('note: kept 3+ high cards', codes.includes('keptManyHigh'));
  t('no note on cheap inkables returned while 3+ inkables stay', !codes.includes('returnedCheapInkable'));
  const all = H.analyze(H.mulligan(H.deal(CARDS, 12), uids(H.deal(CARDS, 12).hand)), INFO, 'first');
  t('note: all 7 returned', all.notes.some((n) => n.code === 'returnedAll'));
  t('every probability is between 0 and 1', ['keep', 'expect', 'final'].every((s) => Object.values(all.probs[s]).every((p) => p >= 0 && p <= 1)));
  t('decision and result are separate verdicts', ['up', 'down', 'same'].includes(all.decision) && ['up', 'down', 'same'].includes(all.result));
  // speed: the whole analysis, exact, well under 50 ms
  const t0 = performance.now(); for (let i = 0; i < 50; i++) H.analyze(H.mulligan(H.deal(CARDS, i), uids(H.deal(CARDS, i).hand.slice(0, 3))), INFO, i % 2 ? 'first' : 'second');
  const per = (performance.now() - t0) / 50;
  t('analysis is fast (< 5 ms here, 50 ms on a phone)', per < 5, `${per.toFixed(2)} ms`);
}

// ---------- practice decks of 7 to 13 cards (Conselho, review of #317) ----------
// k ≤ N: the expectation must equal the exact average over every possible set of replacements (all k-subsets of the
// library, equally likely). k > N: no chance involved — the expectation is the outcome, flagged as forced, never 0.
{
  const subsets = (arr, k, start = 0, cur = [], out = []) => { if (cur.length === k) { out.push(cur.slice()); return out; } for (let i = start; i < arr.length; i++) { cur.push(arr[i]); subsets(arr, k, i + 1, cur, out); cur.pop(); } return out; };
  const probsOf = (hand, lib, ord) => {
    const c = (l, f) => l.filter((x) => f(INFO(x.id))).length;
    return { ink: H.pInkEachTurn(c(hand, (i) => i.inkable), c(lib, (i) => i.inkable), lib.length, ord),
      early: H.pAny(c(hand, (i) => i.cost >= 1 && i.cost <= 2), c(lib, (i) => i.cost >= 1 && i.cost <= 2), lib.length, H.drawsBy(2, ord)),
      three: H.pAny(c(hand, (i) => i.cost === 3), c(lib, (i) => i.cost === 3), lib.length, H.drawsBy(3, ord)) };
  };
  let checked = 0, forcedSeen = 0, zeroBefore = 0;
  for (let size = 7; size <= 13; size++) {
    // a mixed deck: C01..C13 (costs 1–8, every third not inkable), one copy each, the first `size`
    const cards = Object.fromEntries(Array.from({ length: size }, (_, i) => [`C${String(i + 1).padStart(2, '0')}`, 1]));
    for (const ord of ['first', 'second']) for (let k = 0; k <= 7; k++) for (const seed of [1, 2, 3]) {
      const d = H.deal(cards, seed * 100 + size), back = uids(d.hand.slice(0, k)), m = H.mulligan(d, back), a = H.analyze(m, INFO, ord);
      const N = d.library.length, vals = ['keep', 'expect', 'final'].flatMap((s) => Object.values(a.probs[s]));
      t(`${size} cards, return ${k} (${ord}): every number is a probability`, vals.every((p) => Number.isFinite(p) && p >= 0 && p <= 1));
      t(`${size} cards, return ${k}: 7 in hand, ${size} in all`, m.final.length === 7 && m.final.length + m.library.length === size);
      if (k > N) {
        forcedSeen++;
        t(`${size} cards, return ${k} > ${N} left: forced, expectation = what came`, a.forced === true && JSON.stringify(a.probs.expect) === JSON.stringify(a.probs.final));
        t(`${size} cards, return ${k}: the whole library comes, then the first returned`, JSON.stringify(uids(m.drawn)) === JSON.stringify(uids(d.library).concat(back.slice(0, k - N))));
        // the old code gave 0 here whenever the hand still had chances
        if (Object.values(a.probs.final).some((p) => p > 0)) { zeroBefore++; t(`${size} cards, return ${k}: not zeroed`, Object.values(a.probs.expect).some((p) => p > 0)); }
      } else if (k > 0) {
        const kept = d.hand.filter((c) => !back.includes(c.uid)), ret = d.hand.filter((c) => back.includes(c.uid));
        const all = subsets(d.library, k), avg = { ink: 0, early: 0, three: 0 };
        for (const s of all) { const rest = d.library.filter((c) => !s.includes(c)).concat(ret), p = probsOf(kept.concat(s), rest, ord); for (const key in avg) avg[key] += p[key] / all.length; }
        t(`${size} cards, return ${k} ≤ ${N} (${ord}): expectation = exact average over ${all.length} swaps`, ['ink', 'early', 'three'].every((key) => near(a.probs.expect[key], avg[key], 1e-9)) && a.forced === false,
          JSON.stringify([a.probs.expect, avg]));
        checked++;
      }
    }
  }
  t('small decks: cases with k ≤ N were checked exhaustively', checked > 50, String(checked));
  t('small decks: forced cases (k > N) were met', forcedSeen > 20 && zeroBefore > 0, `${forcedSeen} / ${zeroBefore}`);
}
// all 7 put back: "random" only when the rest of the deck has 7 or more cards
{
  const seven = H.analyze(H.mulligan(H.deal({ C01: 4, C02: 3 }, 1), uids(H.deal({ C01: 4, C02: 3 }, 1).hand)), INFO, 'first');
  const n7 = seven.notes.find((n) => n.code.startsWith('returnedAll'));
  t('7-card deck, all 7 back: forced, nothing left to draw, the same hand back', n7?.code === 'returnedAllForced' && n7.n === 0 && n7.back === 7, JSON.stringify(n7));
  const d9 = H.deal({ C01: 5, C02: 4 }, 2), nine = H.analyze(H.mulligan(d9, uids(d9.hand)), INFO, 'first'), n9 = nine.notes.find((n) => n.code.startsWith('returnedAll'));
  t('9-card deck, all 7 back: the 2 left, then 5 of the returned', n9?.code === 'returnedAllForced' && n9.n === 2 && n9.back === 5, JSON.stringify(n9));
  t('never "random" for a forced swap', !seven.notes.concat(nine.notes).some((n) => n.code === 'returnedAll'));
  const d14 = H.deal(Object.fromEntries(Array.from({ length: 14 }, (_, i) => [`C${String(i + 1).padStart(2, '0')}`, 1])), 3);
  t('14-card deck, all 7 back: random (7 left)', H.analyze(H.mulligan(d14, uids(d14.hand)), INFO, 'first').notes.some((n) => n.code === 'returnedAll'));
}
// every number at 100% is flagged, so the screen can say these measures do not separate decisions
{
  const allInk = Object.fromEntries(Array.from({ length: 15 }, (_, i) => [`K${String(i + 1).padStart(2, '0')}`, 4]));
  const INK = (id) => ({ known: true, cost: (+id.slice(1) % 3) + 1, inkable: true });   // every card inkable, costs 1–3
  const a = H.analyze(H.mulligan(H.deal(allInk, 5), []), INK, 'first');
  t('all at 100%: saturated', a.saturated === true);
  t('a normal hand is not saturated', H.analyze(H.mulligan(H.deal(CARDS, 77), []), INFO, 'first').saturated === false);
}

console.log(`${ok} passed, ${bad} failed`);
process.exit(bad ? 1 : 0);
