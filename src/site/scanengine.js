/* Coleção › Escanear: the card-recognition engine (one card, and every pocket of "Escanear página").
   Moved out of colecao.template.html unchanged so the same code runs on the page and in a Web Worker
   (Escanear página recognises a whole binder page off the main thread). Pure: no DOM, no fetch.

     const E = INKWELL_SCANENGINE;   E.use(index)   // index: { ids, D: Int8Array, dims, n, norm }
     E.identify(img, grid?)  E.identifyPocket(img)  E.identifyLuma(img, grid)   // img: { width, height, data } RGBA

   Keep SG in step with tools/build_scan_index.py. The Worker gets this file's source through INKWELL_SCANENGINE_FACTORY.
*/
(function (root) {
  "use strict";
  function factory() {
  const SG = { gx: 16, gy: 12, cell: 14, ax: 13, ay: 26, W: 250, H: 350, M: 0.10 };   // keep in step with tools/build_scan_index.py
  let SCAN = null, NORM_L = null;
  const use = (index) => { SCAN = index; NORM_L = null; DL = null; };
  const lin = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
  const fl = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  function lab(r, g, b) {
    const R = lin(r), G = lin(g), B = lin(b);
    const x = fl((R * 0.4124 + G * 0.3576 + B * 0.1805) / 0.95047), y = fl(R * 0.2126 + G * 0.7152 + B * 0.0722), z = fl((R * 0.0193 + G * 0.1192 + B * 0.9505) / 1.08883);
    return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
  }
  function integral(img) {   // ImageData -> summed-area table, 3 channels
    const { width: w, height: h, data } = img, W1 = w + 1, I = new Float64Array(W1 * (h + 1) * 3);
    for (let y = 0; y < h; y++) { let r = 0, g = 0, b = 0;
      for (let x = 0; x < w; x++) { const p = (y * w + x) * 4; r += data[p]; g += data[p + 1]; b += data[p + 2];
        const o = ((y + 1) * W1 + x + 1) * 3, u = (y * W1 + x + 1) * 3; I[o] = I[u] + r; I[o + 1] = I[u + 1] + g; I[o + 2] = I[u + 2] + b; } }
    return { I, w, h };
  }
  function fingerprint(T, ox, oy, s) {   // same steps as tools/build_scan_index.py: cell means -> Lab -> standardise -> unit length
    const { I, w, h } = T, W1 = w + 1, n = SG.gx * SG.gy, v = new Float32Array(n * 3), cell = SG.cell * s, x0 = ox + SG.ax * s, y0 = oy + SG.ay * s;
    for (let j = 0; j < SG.gy; j++) for (let i = 0; i < SG.gx; i++) {
      let xa = Math.round(x0 + i * cell), xb = Math.round(x0 + (i + 1) * cell), ya = Math.round(y0 + j * cell), yb = Math.round(y0 + (j + 1) * cell);
      xa = Math.max(0, xa); xb = Math.min(w, Math.max(xa + 1, xb)); ya = Math.max(0, ya); yb = Math.min(h, Math.max(ya + 1, yb));
      const a = (yb * W1 + xb) * 3, b = (ya * W1 + xb) * 3, c = (yb * W1 + xa) * 3, d = (ya * W1 + xa) * 3, area = (xb - xa) * (yb - ya);
      const L = lab((I[a] - I[b] - I[c] + I[d]) / area, (I[a + 1] - I[b + 1] - I[c + 1] + I[d + 1]) / area, (I[a + 2] - I[b + 2] - I[c + 2] + I[d + 2]) / area);
      const k = (j * SG.gx + i) * 3; v[k] = L[0]; v[k + 1] = L[1]; v[k + 2] = L[2];
    }
    for (let ch = 0; ch < 3; ch++) { let m = 0, q = 0; for (let k = ch; k < v.length; k += 3) m += v[k]; m /= n; for (let k = ch; k < v.length; k += 3) q += (v[k] - m) ** 2;
      const sd = Math.sqrt(q / n) + 1e-6; for (let k = ch; k < v.length; k += 3) v[k] = (v[k] - m) / sd; }
    let q = 0; for (let k = 0; k < v.length; k++) q += v[k] * v[k]; q = Math.sqrt(q) || 1; for (let k = 0; k < v.length; k++) v[k] /= q;
    return v;
  }
  // Card size in the frame: from 60% (a card held far away, or a picture on a screen) to 110% of the guide.
  // Coarse pass over sizes and positions; the fine pass refines around the best coarse placements.
  const COARSE = [];
  for (const s of [0.62, 0.7, 0.78, 0.86, 0.94, 1, 1.07]) {
    const d = Math.max(0.035, (1.04 - s) * 0.38);   // a smaller card can sit further from the centre
    for (const dx of [-d, 0, d]) for (const dy of [-d, 0, d]) COARSE.push([s, dx, dy]);
  }
  const fineAround = ([s, dx, dy]) => { const g = [];
    for (const ks of [0.95, 0.975, 1, 1.025, 1.05]) for (const ex of [-0.03, -0.015, 0, 0.015, 0.03]) for (const ey of [-0.03, -0.015, 0, 0.015, 0.03]) g.push([s * ks, dx + ex * s, dy + ey * s]);
    return g; };
  function variants(T, grid) {
    return grid.map(([s, dx, dy]) => { const ox = T.w / 2 - (SG.W / 2) * s + dx * SG.W, oy = T.h / 2 - (SG.H / 2) * s + dy * SG.H; return { v: fingerprint(T, ox, oy, s), s, dx, dy }; });
  }
  const dot = (i, v) => { const { D, dims } = SCAN; let q = 0; for (let k = 0, o = i * dims; k < dims; k++) q += D[o + k] * v[k]; return q / SCAN.norm[i]; };   // SCAN: see use()
  // Returns { id, score, group: [ids with the same art], confident }
  // Escanear página: each pocket is already cut out of a straightened page, so the card sits near the middle at
  // about the frame's size; a smaller search is enough there (36 placements instead of 63).
  const POCKET = [];
  for (const s of [0.86, 0.93, 1, 1.07]) for (const dx of [-0.04, 0, 0.04]) for (const dy of [-0.04, 0, 0.04]) POCKET.push([s, dx, dy]);
  function identify(img, grid = COARSE) {
    const T = integral(img), Q = variants(T, grid), n = SCAN.n, coarse = new Float32Array(n), where = new Int16Array(n);
    for (let i = 0; i < n; i++) { let best = -1, bq = 0; for (let j = 0; j < Q.length; j++) { const d = dot(i, Q[j].v); if (d > best) { best = d; bq = j; } } coarse[i] = best; where[i] = bq; }
    const order = [...coarse.keys()].sort((a, b) => coarse[b] - coarse[a]), top = order.slice(0, 15);
    const seeds = [...new Set(top.slice(0, 6).map((i) => where[i]))].slice(0, 3);   // the placements the best candidates agree on
    const F = variants(T, seeds.flatMap((j) => fineAround(grid[j])));
    const fine = top.map((i) => { let best = -1, at = null; for (const q of F) { const d = dot(i, q.v); if (d > best) { best = d; at = q; } } return [i, best, at]; }).sort((a, b) => b[1] - a[1]);
    const [bi, bs, at] = fine[0], group = fine.filter(([, s]) => s >= bs - 0.04).map(([i]) => SCAN.ids[i]);
    const runner = (fine.find(([, s]) => s < bs - 0.04) || [0, coarse[order[15]]])[1];
    // where the card sits in the analysed image (fractions), so the collector line can be cut out precisely
    const box = { x: (T.w / 2 - (SG.W / 2) * at.s + at.dx * SG.W) / T.w, y: (T.h / 2 - (SG.H / 2) * at.s + at.dy * SG.H) / T.h, w: SG.W * at.s / T.w, h: SG.H * at.s / T.h };
    const best = fine.slice(0, 8).map(([i, s]) => ({ id: SCAN.ids[i], s: Math.round(s * 1000) / 1000 }));   // suggestions when the person corrects a pocket
    return { id: SCAN.ids[bi], score: bs, gap: bs - runner, group, confident: (bs >= 0.70 && bs - runner >= 0.15) || (bs >= 0.80 && bs - runner >= 0.08), box, top: best };   // a glare spot lowers the gap, not the match
  }
  // Foil shine and a dim room change the colours more than the light-and-dark pattern of the art. When the colour match
  // isn't sure, compare only the lightness (L) part of the fingerprint, over every card. Its answer is never taken as
  // sure: at most the pocket says "Confira" with that card first.
  // Foil shine and uneven light add a slow gradient over the art. "detrend" removes the best-fitting plane from the
  // lightness grid of both the photo and every indexed card before comparing. Used by Escanear página's fallback
  // (on by default there since the 24/11 measurement: foil / hard pages much better, nothing else changed).
  let DL = null;
  function detrendL(get, out) {   // get(k): lightness of cell k (row-major gx × gy); out: Float32Array(gx*gy), unit length
    const gx = SG.gx, gy = SG.gy, n = gx * gy; let sx = 0, sy = 0, sxx = 0, syy = 0, sv = 0, sxv = 0, syv = 0;
    for (let k = 0; k < n; k++) { const x = (k % gx) - (gx - 1) / 2, y = Math.floor(k / gx) - (gy - 1) / 2, v = get(k); sx += x; sy += y; sxx += x * x; syy += y * y; sv += v; sxv += x * v; syv += y * v; }
    const a = sv / n, b = sxv / sxx, c = syv / syy; let q = 0;
    for (let k = 0; k < n; k++) { const x = (k % gx) - (gx - 1) / 2, y = Math.floor(k / gx) - (gy - 1) / 2, r = get(k) - a - b * x - c * y; out[k] = r; q += r * r; }
    q = Math.sqrt(q) || 1; for (let k = 0; k < n; k++) out[k] /= q;
    return out;
  }
  function identifyLumaDetrend(img, grid) {
    const { D, dims, n } = SCAN, m = dims / 3;
    if (!DL) { DL = new Float32Array(n * m); const tmp = new Float32Array(m); for (let i = 0; i < n; i++) { detrendL((k) => D[i * dims + k * 3], tmp); DL.set(tmp, i * m); } }
    const Q = variants(integral(img), grid).map((q) => detrendL((k) => q.v[k * 3], new Float32Array(m)));
    const sc = new Float32Array(n);
    for (let i = 0; i < n; i++) { let best = -1; const o = i * m; for (const v of Q) { let d = 0; for (let k = 0; k < m; k++) d += DL[o + k] * v[k]; if (d > best) best = d; } sc[i] = best; }
    const order = [...sc.keys()].sort((a, b) => sc[b] - sc[a]), b0 = order[0];
    const runner = order.find((i) => sc[i] < sc[b0] - 0.04);
    return { id: SCAN.ids[b0], score: sc[b0], gap: sc[b0] - (runner == null ? 0 : sc[runner]), top: order.slice(0, 6).map((i) => ({ id: SCAN.ids[i], s: Math.round(sc[i] * 1000) / 1000 })) };
  }
  function identifyLuma(img, grid) {
    const { D, dims, n } = SCAN;
    if (!NORM_L) { NORM_L = new Float32Array(n); for (let i = 0; i < n; i++) { let q = 0; for (let k = i * dims; k < (i + 1) * dims; k += 3) q += D[k] * D[k]; NORM_L[i] = Math.sqrt(q) || 1; } }
    const Q = variants(integral(img), grid).map((q) => { let z = 0; for (let k = 0; k < q.v.length; k += 3) z += q.v[k] * q.v[k]; return { v: q.v, z: Math.sqrt(z) || 1 }; });
    const sc = new Float32Array(n);
    for (let i = 0; i < n; i++) { let best = -1; const o = i * dims; for (const q of Q) { let d = 0; for (let k = 0; k < dims; k += 3) d += D[o + k] * q.v[k]; d /= NORM_L[i] * q.z; if (d > best) best = d; } sc[i] = best; }
    const order = [...sc.keys()].sort((a, b) => sc[b] - sc[a]), b0 = order[0];
    const runner = order.find((i) => sc[i] < sc[b0] - 0.04);   // the same art in other printings scores alike: skip those
    return { id: SCAN.ids[b0], score: sc[b0], gap: sc[b0] - (runner == null ? 0 : sc[runner]), top: order.slice(0, 6).map((i) => ({ id: SCAN.ids[i], s: Math.round(sc[i] * 1000) / 1000 })) };
  }
  function identifyPocket(img, opts) {
    const r = identify(img, POCKET); if (r.confident) return r;
    const l = opts && opts.detrend ? identifyLumaDetrend(img, POCKET) : identifyLuma(img, POCKET);
    if (l.score >= 0.72 && l.gap >= 0.06) {   // a good lightness match: suggest it, the person confirms
      const top = [...l.top, ...r.top.filter((t) => !l.top.some((x) => x.id === t.id))];
      return { ...r, id: l.id, score: Math.max(0.55, Math.min(r.score, 0.69)), confident: false, lumaOnly: true, top };
    }
    return r;
  }

  return { SG, COARSE, POCKET, use, ready: () => !!SCAN, integral, fingerprint, variants, identify, identifyLuma, identifyPocket };
  }
  root.INKWELL_SCANENGINE_FACTORY = factory;
  root.INKWELL_SCANENGINE = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = root.INKWELL_SCANENGINE;
})(typeof window !== "undefined" ? window : globalThis);
