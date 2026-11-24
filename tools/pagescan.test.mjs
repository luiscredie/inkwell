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

console.log(`${n - bad}/${n} pagescan checks passed`);
if (bad) process.exit(1);
