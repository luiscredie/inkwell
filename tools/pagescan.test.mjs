// node tools/pagescan.test.mjs — Scanner 2.0 page geometry and pocket rules (src/site/pagescan.js)
import fs from 'node:fs';
import vm from 'node:vm';

const ctx = { window: {}, performance }; vm.createContext(ctx);
vm.runInContext(fs.readFileSync(new URL('../src/site/pagescan.js', import.meta.url), 'utf8'), ctx);
const PS = ctx.window.INKWELL_PAGESCAN;

let n = 0, bad = 0;
const ok = (c, m) => { n++; if (!c) { bad++; console.error('FAIL', m); } };
const near = (a, b, e = 1e-6) => Math.abs(a - b) <= e;

// --- homography: maps the 4 points exactly, and the identity is the identity
{
  const src = [[0, 0], [100, 0], [100, 140], [0, 140]], dst = [[12, 30], [118, 22], [130, 170], [5, 160]];
  const H = PS.homography(src, dst);
  src.forEach((p, i) => { const [x, y] = PS.apply(H, ...p); ok(near(x, dst[i][0], 1e-6) && near(y, dst[i][1], 1e-6), `homography corner ${i}`); });
  const I = PS.homography(src, src); ok(I.every((v, i) => near(v, [1, 0, 0, 0, 1, 0, 0, 0, 1][i], 1e-9)), 'identity');
  // a straight line stays straight (projective map): the midpoint of an edge stays on the mapped edge
  const [mx, my] = PS.apply(H, 50, 0), [ax, ay] = dst[0], [bx, by] = dst[1];
  ok(near((bx - ax) * (my - ay) - (by - ay) * (mx - ax), 0, 1e-6), 'lines stay lines');
  let threw = false; try { PS.homography([[0, 0], [0, 0], [1, 1], [2, 2]], dst); } catch { threw = true; } ok(threw, 'degenerate corners throw');
}

// --- validQuad: convex, ordered corners only
ok(PS.validQuad([[0, 0], [10, 0], [10, 10], [0, 10]]), 'square is valid');
ok(PS.validQuad([[0, 0], [0, 10], [10, 10], [10, 0]]), 'the other turn is valid too');
ok(!PS.validQuad([[0, 0], [10, 10], [10, 0], [0, 10]]), 'crossed corners are not');
ok(!PS.validQuad([[0, 0], [10, 0], [2, 2], [0, 10]]), 'a dent is not');
ok(!PS.validQuad([[0, 0], [10, 0], [10, 10]]), 'three corners are not');
ok(!PS.validQuad([[0, 0], [10, 0], [10, NaN], [0, 10]]), 'NaN is not');

// a test picture: 9 coloured blocks (one per pocket) on grey, drawn in a tilted quad inside a 400×500 photo
const COL = [[220, 40, 40], [40, 200, 40], [40, 40, 220], [220, 220, 40], [220, 40, 220], [40, 220, 220], [250, 140, 0], [120, 60, 20], [240, 240, 240]];
function photo(quad, W = 400, H = 500) {
  const data = new Uint8ClampedArray(W * H * 4), Hm = PS.homography(quad, [[0, 0], [1, 0], [1, 1], [0, 1]]);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const [u, v] = PS.apply(Hm, x + 0.5, y + 0.5), o = (y * W + x) * 4;
    let c = [90, 90, 90];
    if (u >= 0 && u < 1 && v >= 0 && v < 1) { const i = Math.floor(v * 3) * 3 + Math.floor(u * 3), fu = (u * 3) % 1, fv = (v * 3) % 1; c = fu > 0.08 && fu < 0.92 && fv > 0.06 && fv < 0.94 ? COL[i] : [30, 30, 36]; }
    data[o] = c[0]; data[o + 1] = c[1]; data[o + 2] = c[2]; data[o + 3] = 255;
  }
  return { width: W, height: H, data };
}
const Q = [[60, 40], [350, 70], [330, 470], [40, 440]];
const img = photo(Q);

// --- warp: each pocket's middle has its own colour back, in order
{
  const page = PS.warp(img, Q, 300, 420), cs = PS.cells('3x3', 300, 420);
  ok(cs.length === 9 && cs[4].r === 1 && cs[4].c === 1 && near(cs[8].x, 200) && near(cs[8].y, 280), 'cells row by row');
  cs.forEach((c, i) => {
    const o = (Math.round(c.y + c.h / 2) * 300 + Math.round(c.x + c.w / 2)) * 4, px = [page.data[o], page.data[o + 1], page.data[o + 2]];
    ok(px.every((v, k) => Math.abs(v - COL[i][k]) <= 3), `pocket ${i} colour ${px} vs ${COL[i]}`);
  });
  let threw = false; try { PS.warp(img, [[0, 0], [10, 10], [10, 0], [0, 10]], 10, 10); } catch { threw = true; } ok(threw, 'warp refuses crossed corners');
}

// --- cellQuads: the outline of pocket 0 starts at the page corner; pocket 8 ends at the opposite one
{
  const qs = PS.cellQuads('3x3', Q);
  ok(qs.length === 9 && near(qs[0][0][0], Q[0][0]) && near(qs[0][0][1], Q[0][1]) && near(qs[8][2][0], Q[2][0]) && near(qs[8][2][1], Q[2][1]), 'cellQuads corners');
  ok(PS.cellQuads('2x2', Q).length === 4 && PS.cellQuads('4x4', Q).length === 16, 'other layouts cut too');
}

// --- crop + texture: a flat pocket reads as empty, a busy one does not
{
  const flat = { width: 40, height: 56, data: new Uint8ClampedArray(40 * 56 * 4).fill(60) };
  ok(PS.texture(flat).luma < PS.EMPTY_LUMA, 'flat is empty');
  const busy = { width: 40, height: 56, data: new Uint8ClampedArray(40 * 56 * 4) };
  let seed = 7; for (let i = 0; i < 40 * 56; i++) { seed = (seed * 1103515245 + 12345) >>> 0; const v = seed >>> 24; busy.data[i * 4] = v; busy.data[i * 4 + 1] = v; busy.data[i * 4 + 2] = 255 - v; busy.data[i * 4 + 3] = 255; }
  ok(PS.texture(busy).luma > PS.EMPTY_LUMA * 3, 'art is not empty');
  const c = PS.crop(busy, { x: 10, y: 10, w: 20, h: 28 }, 0.1, 30, 42);
  ok(c.width === 30 && c.height === 42 && c.data.length === 30 * 42 * 4, 'crop size');
  const edge = PS.crop(busy, { x: -5, y: -5, w: 20, h: 20 }, 0.5, 10, 10); ok(edge.data.every((v) => v >= 0 && v <= 255), 'crop outside the page repeats the edge');
}

// --- classify
{
  const R = (o) => ({ id: 'A', score: 0.9, gap: 0.2, group: ['A'], confident: true, top: [], ...o });
  ok(PS.classify(R(), { luma: 40 }) === 'ok', 'ok');
  ok(PS.classify(R({ group: ['A', 'B'] }), { luma: 40 }) === 'choose', 'choose');
  ok(PS.classify(R({ confident: false, score: 0.6 }), { luma: 40 }) === 'check', 'check');
  ok(PS.classify(R({ confident: false, score: 0.4 }), { luma: 40 }) === 'unknown', 'unknown');
  ok(PS.classify(R(), { luma: 3 }) === 'empty', 'flat pocket is empty whatever the match says');
  ok(PS.classify(null, { luma: 40 }) === 'unknown', 'no result');
}

// --- toList: only sure or settled pockets; nothing while a pocket waits; quantity, foil, skip
{
  const P = (o) => ({ id: 'A', status: 'ok', qty: 1, foil: false, ...o });
  let threw = false; try { PS.toList([P(), P({ status: 'check', id: 'B' })]); } catch { threw = true; } ok(threw, 'a pocket to check blocks the list');
  threw = false; try { PS.toList([P({ status: 'unknown', id: null })]); } catch { threw = true; } ok(threw, 'an unrecognised pocket blocks the list');
  threw = false; try { PS.toList([P({ status: 'choose', id: 'A', group: ['A', 'B'] })]); } catch { threw = true; } ok(threw, 'a printing to pick blocks the list');
  const L = PS.toList([P(), P({ id: 'B', qty: 3, foil: true }), P({ status: 'check', id: 'C', resolved: true }), P({ status: 'unknown', id: null, resolved: true, skip: true }),
    P({ status: 'empty', id: null }), P({ id: 'D', skip: true, resolved: true }), P({ status: 'empty', id: 'E', resolved: true })]);
  ok(JSON.stringify(L.map((x) => x.id + (x.foil ? '*' : ''))) === JSON.stringify(['A', 'B*', 'B*', 'B*', 'C', 'E']), `list ${L.map((x) => x.id)}`);
  ok(PS.toList([]).length === 0, 'empty page, empty list');
  ok(!PS.pending(P({ status: 'empty' })) && PS.pending(P({ status: 'check' })) && !PS.pending(P({ status: 'check', resolved: true })), 'pending');
}

// --- signature: same cards, same signature; empty pockets count
ok(PS.signature([{ id: 'A', status: 'ok' }, { status: 'empty' }, { id: null, status: 'unknown' }]) === 'A,-,?', 'signature');
ok(PS.signature([{ id: 'B1', status: 'ok', group: ['B1', 'B2'] }]) === PS.signature([{ id: 'B2', status: 'choose', group: ['B2', 'B1'] }]), 'shared art: same signature whichever printing the OCR picked');
ok(PS.signature([{ id: 'C', status: 'empty' }]) === 'C', 'an "empty" pocket the person filled counts as that card');

// --- scanPage end to end with a fake identify: picks the pocket colour, reports empty pockets, times
{
  const dark = photo(Q); // pocket 7 (brown) made flat: nothing in it
  const page0 = PS.warp(dark, Q, 750, 1050);
  const id = (im) => { const o = ((im.height >> 1) * im.width + (im.width >> 1)) * 4, c = [im.data[o], im.data[o + 1], im.data[o + 2]];
    const i = COL.findIndex((k) => k.every((v, j) => Math.abs(v - c[j]) < 20)); return { id: 'C' + i, score: 0.9, gap: 0.3, group: ['C' + i], confident: i >= 0, top: [] }; };
  const seen = [];
  const r = await PS.scanPage({ image: dark, quad: Q, identify: id, onPocket: (p, i) => seen.push(i) });
  ok(r.pockets.length === 9 && seen.join() === '0,1,2,3,4,5,6,7,8', 'nine pockets in order');
  // flat colour blocks have no texture: they all read "empty" (cards always have texture) — check that, then with art
  ok(r.pockets.every((p) => p.status === 'empty'), 'flat blocks are empty pockets');
  ok(r.ms.total >= 0 && page0.width === 750, 'timings');
  // give each block texture (stripes) so it reads as a card
  const art = { width: dark.width, height: dark.height, data: dark.data.slice() };
  for (let y = 0; y < art.height; y++) for (let x = 0; x < art.width; x++) if ((x >> 1) % 3 === 0) { const o = (y * art.width + x) * 4; if (art.data[o] !== 90 && !(art.data[o] === 120 && art.data[o + 1] === 60)) for (let k = 0; k < 3; k++) art.data[o + k] = art.data[o + k] * 0.4; }
  const r2 = await PS.scanPage({ image: art, quad: Q, identify: (im) => { const res = id(im); return res; } });
  ok(r2.pockets.filter((p) => p.status !== 'empty').length >= 7, `textured pockets read as cards: ${r2.pockets.map((p) => p.status)}`);
}


// --- the collector line, adversarial (Conselho 26/11): an ambiguous reading must never settle a pocket
{
  const cat = new Set(JSON.parse(fs.readFileSync(new URL('../site/data/cards.json', import.meta.url), 'utf8').replace(/^﻿/, '')).cards.map((c) => c.card_id));
  const has = (id) => cat.has(id), D = (p, reads) => PS.decideNumber(p, reads, has), J = (x) => JSON.stringify(x);
  const eq = (got, want, msg) => ok(J(got) === J(want), `${msg}: got ${J(got)}, want ${J(want)}`);
  // parsing: real formats, and what must not count as a reading
  eq(PS.parseCollector('125/204 EN 11'), { num: 125, total: 204, set: 11 }, 'parse: plain');
  eq(PS.parseCollector('7/204 · EN · 9'), { num: 7, total: 204, set: 9 }, 'parse: with the middle dots');
  eq(PS.parseCollector('206/204 . EN . 4'), { num: 206, total: 204, set: 4 }, 'parse: Enchanted, number above the total');
  eq(PS.parseCollector('125 / 204 EN 11'), { num: 125, total: 204, set: 11 }, 'parse: spaces around the slash');
  eq(PS.parseCollector('125/204'), { num: 125, total: 204, set: null }, 'parse: set not read');
  for (const bad of ['12S/204 EN 11', 'A125/204 EN 11', '125/2041 EN 1', '5/99 EN 3', '125/204 EN 113', '125/204 EN 0', '999/204 EN 4', '', 'EN 11', '|:/;.', '1/ 2O4 EN 1', '204', '/204 EN 4'])
    eq(PS.parseCollector(bad), null, `parse: not a reading "${bad}"`);
  // reprints, real groups of the catalogue
  const letItGo = { status: 'choose', id: 'LOR1-163', group: ['LOR1-163', 'LOR11-163'] };          // same number, set 1 and set 11
  eq(D(letItGo, ['163/204 EN 11']), null, 'reprint: "EN 11" could be "EN 1" with a separator read as 1: the person picks');
  eq(D(letItGo, ['163/204 EN 1']), null, 'reprint: "EN 1" could be "EN 11" with a dropped digit');
  eq(D(letItGo, ['163/204']), null, 'reprint: the number alone fits both printings');
  eq(D(letItGo, ['163/204 EN 11', '163/204 EN 1']), null, 'reprint: readings disagree on the set');
  const sven = { status: 'choose', id: 'LOR1-55', group: ['LOR1-55', 'LOR9-56'] };                // 55 vs 56: 5↔6
  eq(D(sven, ['55/204 EN 1']), { pick: 'LOR1-55' }, 'reprint: number and set name one printing');
  eq(D(sven, ['56/204 EN 9']), { pick: 'LOR9-56' }, 'reprint: the other printing');
  eq(D(sven, ['56/204 EN 1']), null, 'reprint: a real card outside the group (LOR1-56): art and number disagree');
  eq(D(sven, ['56/204']), null, 'reprint: no set, and 56 could be a misread 55');
  eq(D(sven, ['55/204 EN 1', '56/204']), null, 'reprint: a reading without set names another number');
  const julieta = { status: 'choose', id: 'LOR4-13', group: ['LOR4-13', 'LOR9-18'] };            // 13 vs 18: 3↔8
  eq(D(julieta, ['13/204 EN 4']), { pick: 'LOR4-13' }, 'reprint: 3↔8 pair, set read');
  eq(D(julieta, ['18/204 EN 4']), null, 'reprint: 18 with set 4 is not one of the printings');
  // a pocket the art didn't settle: only the art's own first card can be settled by the number
  const hk = { status: 'check', id: 'LOR13-22', top: [{ id: 'LOR13-22' }, { id: 'LOR1-130' }] };
  eq(D(hk, ['22/204 EN 13']), { pick: 'LOR13-22' }, 'unsure: the number confirms the art');
  eq(D(hk, ['80/204 EN 13']), { suggest: 'LOR13-80' }, 'unsure: the number names another card: only a suggestion');
  eq(D(hk, ['80/204 EN 13', '80/204 EN 13', '80/204 EN 13']), { suggest: 'LOR13-80' }, 'unsure: three equal readings are still only a suggestion');
  eq(D(hk, ['22/204 EN 13', '28/204 EN 13']), null, 'unsure: readings disagree (3↔8): nothing');
  eq(D(hk, ['22/204 EN 13', '23/204']), null, 'unsure: a reading without set names another number');
  eq(D({ ...hk, top: [{ id: 'LOR13-22' }, { id: 'LOR13-122' }] }, ['22/204 EN 13']), null, 'unsure: 22 vs 122 among the art\'s cards: a dropped digit');
  eq(D({ status: 'check', id: 'LOR9-56', top: [{ id: 'LOR9-56' }, { id: 'LOR1-55' }] }, ['55/204 EN 9']), null, 'unsure: 55 read where the art says 56 (5↔6 among its cards)');
  eq(D({ status: 'unknown', id: null, top: [] }, ['206/204 EN 4']), { suggest: 'LOR4-206' }, 'unknown pocket: never settled by the number alone');
  eq(D(hk, ['999/204 EN 13']), null, 'unsure: no such card');
  eq(D({ status: 'ok', id: 'LOR13-22' }, ['80/204 EN 13']), null, 'a settled pocket is not changed');
  eq(D({ status: 'empty' }, ['80/204 EN 13']), null, 'an empty pocket is not changed');
  // foil: sparkle read as text
  for (const noise of [['', '', ''], ['|||', '2 0 4', 'EN'], ['1/ 2O4 EN 1', '8/8', '204/']]) eq(D(hk, noise), null, `foil noise ${J(noise)}`);
  // the one-card scanner's reprint rule, moved unchanged
  eq(PS.pickByCollector('7/204 · EN · 9', ['LOR1-7', 'LOR9-7']), 'LOR9-7', 'one-card scanner: unchanged rule');
  eq(PS.pickByCollector('125/204 EN 11 | 125/204 EN 11', ['LOR2-125', 'LOR11-125']), 'LOR11-125', 'one-card scanner: several readings');
}

console.log(`${n - bad}/${n} pagescan checks passed`);
if (bad) process.exit(1);
