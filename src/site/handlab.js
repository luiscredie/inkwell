// Mão de teste e mulligan (Decks › Testar mão). Rules and numbers only: no page, no network, no storage — the page draws
// what these functions return, and tools/handlab.test.mjs checks them in Node.
// Rules: Disney Lorcana Comprehensive Rules 2.3.0 (16/10/2026; same as 2.2.0 for what is used here), 2.2.1–2.2.2 (shuffle, 7 cards, alter the hand once: chosen cards to
// the bottom without revealing them, draw back up to 7, then — only if 1 or more were put back — shuffle the deck) and
// 3.2.3.1 (the starting player skips the draw on the first turn of the game).
// Every copy is its own instance: { uid: "LOR10-1#2", id: "LOR10-1" }. The deck list is only read.
(function (root) {
  "use strict";

  // mulberry32: a small seeded generator, so a hand can be played again (tests, a shared seed)
  function rng(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function newSeed() {
    try { const a = new Uint32Array(1); (root.crypto || globalThis.crypto).getRandomValues(a); return a[0]; } catch { return (Math.random() * 4294967296) >>> 0; }
  }
  // one instance per copy, in a fixed order (ids sorted), so a seed always means the same deck order
  function instances(cards) {
    const out = [];
    for (const id of Object.keys(cards || {}).sort()) { const n = Math.max(0, Math.floor(+cards[id] || 0)); for (let i = 1; i <= n; i++) out.push({ uid: `${id}#${i}`, id }); }
    return out;
  }
  // Fisher–Yates on a copy
  function shuffle(list, rand) {
    const a = list.slice();
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); const t = a[i]; a[i] = a[j]; a[j] = t; }
    return a;
  }
  const HAND = 7;
  // 2.2.1.2 + 2.2.1.4: shuffle, then the top 7 are the opening hand (the library's index 0 is its top)
  function deal(cards, seed) {
    const deck = instances(cards);
    if (deck.length < HAND) return { error: "small", size: deck.length };
    const s = seed == null ? newSeed() : seed >>> 0;
    const order = shuffle(deck, rng(s));
    return { seed: s, size: deck.length, hand: order.slice(0, HAND), library: order.slice(HAND), mulled: false };
  }
  // 2.2.2.1 + 2.2.2.3: the chosen instances go to the bottom, the same number is drawn from the top, and only then —
  // if 1 or more went back — the deck is shuffled. Once per hand.
  function mulligan(state, uids) {
    if (!state || state.error) throw new Error("no hand");
    if (state.mulled) throw new Error("already altered");
    const want = new Set(uids || []);
    if (want.size !== (uids || []).length) throw new Error("same card twice");
    for (const u of want) if (!state.hand.some((c) => c.uid === u)) throw new Error("not in hand: " + u);
    const returned = state.hand.filter((c) => want.has(c.uid)), kept = state.hand.filter((c) => !want.has(c.uid));
    const lib = state.library.concat(returned);   // to the bottom
    const k = returned.length, drawn = lib.slice(0, k);   // from the top: a returned card comes back only if the top ran out
    let library = lib.slice(k);
    if (k > 0) library = shuffle(library, rng((state.seed ^ 0x9e3779b9) >>> 0));
    return { ...state, mulled: true, original: state.hand, before: state.library, returned, kept, drawn, final: kept.concat(drawn), library };
  }

  // ---------- probabilities (exact) ----------
  // d(t): cards drawn by turn t — the starting player skips the turn-1 draw (3.2.3.1)
  const drawsBy = (t, order) => (order === "second" ? t : t - 1);
  const clamp01 = (p) => Math.min(1, Math.max(0, p));   // sums of floats can land at 1.0000000000000002
  // C(n, k) as a float (n stays below ~100 here)
  function choose(n, k) {
    if (k < 0 || k > n || n < 0) return 0;
    k = Math.min(k, n - k); let r = 1;
    for (let i = 1; i <= k; i++) r = (r * (n - k + i)) / i;
    return r;
  }
  // P(j of the K "good" cards among k taken at random from N)
  const hyper = (K, N, k, j) => (choose(N, k) ? (choose(K, j) * choose(N - K, k - j)) / choose(N, k) : 0);
  // P1: inkable cards seen by turn t (hand + draws) are at least t, for every t = 1..T. inkH in hand; K inkable of N left.
  function pInkEachTurn(inkH, K, N, order, T = 4) {
    let dist = new Map([[0, 1]]), n = 0;   // inkables drawn → probability, after n draws
    for (let t = 1; t <= T; t++) {
      const target = Math.min(drawsBy(t, order), N);
      while (n < target) {
        const next = new Map();
        for (const [i, p] of dist) {
          const left = N - n, ink = K - i;
          if (ink > 0) next.set(i + 1, (next.get(i + 1) || 0) + (p * ink) / left);
          if (left - ink > 0) next.set(i, (next.get(i) || 0) + (p * (left - ink)) / left);
        }
        dist = next; n++;
      }
      for (const i of [...dist.keys()]) if (inkH + i < t) dist.delete(i);
    }
    let s = 0; for (const p of dist.values()) s += p; return clamp01(s);
  }
  // P2 / P3: at least one card of a kind by d draws — a in hand, A of that kind left among N
  function pAny(a, A, N, d) {
    if (a >= 1) return 1;
    d = Math.min(Math.max(0, d), N);
    let none = 1; for (let x = 0; x < d; x++) none *= (N - A - x) / (N - x);
    return 1 - Math.max(0, none);
  }
  // the expectation of a decision: k cards go back (r of the kind), k come at random from the N left (A of the kind);
  // the returned cards join what is left, so N stays the same. Only when k ≤ N: with k > N (a practice deck of 7 to 13
  // cards) there is no draw at random — the whole rest of the deck comes, then returned cards from the bottom — so this
  // returns null and analyze() takes the one possible outcome instead.
  function expectAfter(f, inHand, r, A, N, k) {
    if (k > N) return null;
    let s = 0;
    for (let j = 0; j <= Math.min(k, A); j++) { const w = hyper(A, N, k, j); if (w) s += w * f(inHand - r + j, A - j + r, N); }
    return s;
  }

  // ---------- analysis (after the decision only) ----------
  // info(id) → { cost, inkable, known }. Unknown cards count as not inkable and with no cost (and are counted apart).
  const HIGH = 5;   // "custo alto": 5 or more (Conselho 23/11) — an indicator, never "should go back"
  const kinds = {
    ink: (c) => c.known && c.inkable,
    early: (c) => c.known && c.cost >= 1 && c.cost <= 2,
    three: (c) => c.known && c.cost === 3,
  };
  function facts(list, info) {
    const cs = list.map((x) => ({ ...info(x.id), uid: x.uid, id: x.id }));
    const known = cs.filter((c) => c.known);
    return {
      inkable: cs.filter(kinds.ink).length,
      cost1to3: known.filter((c) => c.cost >= 1 && c.cost <= 3).length,
      byCost: [1, 2, 3].map((v) => known.filter((c) => c.cost === v).length),
      high: known.filter((c) => c.cost >= HIGH).length,
      highUninkable: known.filter((c) => c.cost >= HIGH && !c.inkable).length,
      avg: known.length ? known.reduce((s, c) => s + c.cost, 0) / known.length : null,
      unknown: cs.length - known.length,
    };
  }
  const count = (list, info, kind) => list.filter((x) => kind(info(x.id))).length;
  function probs(hand, library, info, order) {
    const N = library.length;
    return {
      ink: pInkEachTurn(count(hand, info, kinds.ink), count(library, info, kinds.ink), N, order),
      early: pAny(count(hand, info, kinds.early), count(library, info, kinds.early), N, drawsBy(2, order)),
      three: pAny(count(hand, info, kinds.three), count(library, info, kinds.three), N, drawsBy(3, order)),
    };
  }
  function analyze(state, info, order) {
    if (!state || !state.mulled) throw new Error("analysis comes after the decision");
    const ord = order === "second" ? "second" : "first", k = state.returned.length, N = state.library.length;
    // "keep all 7": the original hand with the library as it was when the decision was made
    const before = state.before;
    const keep = probs(state.original, before, info, ord);
    const expect = {}, fin = probs(state.final, state.library, info, ord);
    const f = {
      ink: (h, A, n) => pInkEachTurn(h, A, n, ord),
      early: (h, A, n) => pAny(h, A, n, drawsBy(2, ord)),
      three: (h, A, n) => pAny(h, A, n, drawsBy(3, ord)),
    };
    // k > N: the replacements are the whole rest of the deck and then the first returned cards — no chance involved, so
    // the expectation is that one outcome (forced), said on the screen
    const forced = k > before.length;
    for (const key of Object.keys(kinds)) {
      const kind = kinds[key];
      expect[key] = !k ? keep[key] : forced ? fin[key] : clamp01(expectAfter(f[key], count(state.original, info, kind), count(state.returned, info, kind), count(before, info, kind), before.length, k));
    }
    // points to consider: only when the rule applies, naming the cards
    const kept = state.kept.map((x) => ({ ...info(x.id), id: x.id, uid: x.uid })), ret = state.returned.map((x) => ({ ...info(x.id), id: x.id, uid: x.uid }));
    const keptInk = kept.filter(kinds.ink).length, notes = [];
    const cheapInkBack = ret.filter((c) => c.known && c.inkable && c.cost >= 1 && c.cost <= 3);
    if (cheapInkBack.length && keptInk < 3) notes.push({ code: "returnedCheapInkable", uids: cheapInkBack.map((c) => c.uid) });
    const highNoInk = kept.filter((c) => c.known && c.cost >= HIGH && !c.inkable);
    if (highNoInk.length) notes.push({ code: "keptHighUninkable", uids: highNoInk.map((c) => c.uid) });
    const highKept = kept.filter((c) => c.known && c.cost >= HIGH);
    if (highKept.length >= 3) notes.push({ code: "keptManyHigh", uids: highKept.map((c) => c.uid) });
    const finalInk = count(state.final, info, kinds.ink);
    if (finalInk <= 1) notes.push({ code: "finalLowInk", n: finalInk });
    if (k === 7) notes.push({ code: "returnedAll" });
    // decision (expectation vs keeping) and result (what came vs the expectation), separately; < 3 points = the same
    const cmp = (a, b) => (Math.abs(a - b) < 0.03 ? "same" : a > b ? "up" : "down");
    // every number at (rounded) 100%: these measures cannot tell decisions apart in this hand
    const all = ["keep", "expect", "final"].flatMap((s) => Object.keys(kinds).map((key) => ({ keep, expect, final: fin })[s][key]));
    const saturated = all.every((p) => p >= 0.995);
    return {
      order: ord, returnedN: k, size: state.size, forced, saturated, libraryBefore: before.length,
      facts: { original: facts(state.original, info), final: facts(state.final, info) },
      probs: { keep, expect, final: fin },
      decision: k ? cmp(expect.ink, keep.ink) : "kept",
      result: k ? cmp(fin.ink, expect.ink) : cmp(fin.ink, keep.ink),
      notes,
    };
  }

  const api = { rng, newSeed, instances, shuffle, deal, mulligan, analyze, drawsBy, choose, hyper, pInkEachTurn, pAny, expectAfter, HAND, HIGH };
  root.INKWELL_HANDLAB = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
