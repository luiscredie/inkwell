/* Scanner 2.0 — "Escanear página": a binder page photographed at once, every pocket recognised on the phone.
   Pure functions (no DOM): geometry, cutting the page into pockets, empty pockets, the status of each pocket and the
   signature that stops the same page from being added twice. Recognition itself is the existing card fingerprint
   (`identify` in colecao.template.html), passed in, so the one-card scanner and this mode stay the same engine.

   Exposed as window.INKWELL_PAGESCAN (browser) and module.exports (Node tests, tools/pagescan.test.mjs).

   Flow: photo (ImageData) + the page's 4 corners in the photo -> page straightened (homography) -> rows × cols
   pockets -> each pocket cut with a margin -> identify() -> status per pocket. Nothing is saved here.
*/
(function (root) {
  "use strict";
  function factory() {

  // Binder pages. Only 3×3 is offered for now; 2×2 and 4×4 are described so the rest of the code needs no change.
  // aspect: width / height of the area holding the pockets (a pocket is about a card, 63 × 88 mm, plus a seam).
  const LAYOUTS = {
    "3x3": { rows: 3, cols: 3, aspect: 0.72 },
    "2x2": { rows: 2, cols: 2, aspect: 0.72 },
    "4x4": { rows: 4, cols: 4, aspect: 0.72 },
  };

  // --- geometry -------------------------------------------------------------------------------------------------
  // 3×3 homography H with H·(u,v,1) ~ (x,y,1) for the 4 point pairs src[i] -> dst[i]. Gaussian elimination on 8×8.
  function homography(src, dst) {
    const A = [], b = [];
    for (let i = 0; i < 4; i++) {
      const [u, v] = src[i], [x, y] = dst[i];
      A.push([u, v, 1, 0, 0, 0, -u * x, -v * x]); b.push(x);
      A.push([0, 0, 0, u, v, 1, -u * y, -v * y]); b.push(y);
    }
    for (let c = 0; c < 8; c++) {
      let p = c; for (let r = c + 1; r < 8; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
      if (Math.abs(A[p][c]) < 1e-12) throw new Error("degenerate corners");
      [A[c], A[p]] = [A[p], A[c]]; [b[c], b[p]] = [b[p], b[c]];
      for (let r = 0; r < 8; r++) if (r !== c) { const f = A[r][c] / A[c][c]; if (f) { for (let k = c; k < 8; k++) A[r][k] -= f * A[c][k]; b[r] -= f * b[c]; } }
    }
    const h = b.map((v, i) => v / A[i][i]);
    return [h[0], h[1], h[2], h[3], h[4], h[5], h[6], h[7], 1];
  }
  const apply = (H, u, v) => { const w = H[6] * u + H[7] * v + H[8]; return [(H[0] * u + H[1] * v + H[2]) / w, (H[3] * u + H[4] * v + H[5]) / w]; };

  // corners: [top-left, top-right, bottom-right, bottom-left] in photo pixels.
  function validQuad(q) {
    if (!Array.isArray(q) || q.length !== 4 || q.some((p) => !Array.isArray(p) || !isFinite(p[0]) || !isFinite(p[1]))) return false;
    let sign = 0;   // convex and in order: every turn the same way
    for (let i = 0; i < 4; i++) {
      const a = q[i], b = q[(i + 1) % 4], c = q[(i + 2) % 4];
      const z = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
      if (Math.abs(z) < 1e-6) return false;
      if (!sign) sign = Math.sign(z); else if (Math.sign(z) !== sign) return false;
    }
    return true;
  }

  // Straighten the page: W × H output, each output pixel the average of 2×2 samples of the photo (less aliasing
  // when a 12-megapixel photo becomes a 750-pixel page). img: {width, height, data} RGBA.
  function warp(img, quad, W, H) {
    if (!validQuad(quad)) throw new Error("bad corners");
    const M = homography([[0, 0], [W, 0], [W, H], [0, H]], quad), out = new Uint8ClampedArray(W * H * 4);
    const { width: w, height: h, data } = img, S = [0.25, 0.75];
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      let r = 0, g = 0, bl = 0;
      for (const sy of S) for (const sx of S) {
        const [px, py] = apply(M, x + sx, y + sy);
        const fx = Math.min(w - 1.001, Math.max(0, px - 0.5)), fy = Math.min(h - 1.001, Math.max(0, py - 0.5));
        const x0 = fx | 0, y0 = fy | 0, ax = fx - x0, ay = fy - y0, o = (y0 * w + x0) * 4, o2 = o + w * 4;
        r += (data[o] * (1 - ax) + data[o + 4] * ax) * (1 - ay) + (data[o2] * (1 - ax) + data[o2 + 4] * ax) * ay;
        g += (data[o + 1] * (1 - ax) + data[o + 5] * ax) * (1 - ay) + (data[o2 + 1] * (1 - ax) + data[o2 + 5] * ax) * ay;
        bl += (data[o + 2] * (1 - ax) + data[o + 6] * ax) * (1 - ay) + (data[o2 + 2] * (1 - ax) + data[o2 + 6] * ax) * ay;
      }
      const p = (y * W + x) * 4; out[p] = r / 4; out[p + 1] = g / 4; out[p + 2] = bl / 4; out[p + 3] = 255;
    }
    return { width: W, height: H, data: out };
  }

  // Pockets of the straightened page, row by row. Each pocket is one cell of an even grid.
  function cells(layout, W, H) {
    const L = typeof layout === "string" ? LAYOUTS[layout] : layout, out = [];
    for (let r = 0; r < L.rows; r++) for (let c = 0; c < L.cols; c++) out.push({ i: r * L.cols + c, r, c, x: (c * W) / L.cols, y: (r * H) / L.rows, w: W / L.cols, h: H / L.rows });
    return out;
  }
  // Pocket corners back in the photo (to draw the outlines over the picture).
  function cellQuads(layout, quad) {
    const M = homography([[0, 0], [1, 0], [1, 1], [0, 1]], quad);
    return cells(layout, 1, 1).map((c) => [[c.x, c.y], [c.x + c.w, c.y], [c.x + c.w, c.y + c.h], [c.x, c.y + c.h]].map(([u, v]) => apply(M, u, v)));
  }

  // Cut a rectangle (with `m` of its size as margin on each side) out of the page, as outW × outH.
  // Outside the page the edge pixel is repeated. Box filter when shrinking.
  function crop(page, rect, m, outW, outH) {
    const { width: w, height: h, data } = page, out = new Uint8ClampedArray(outW * outH * 4);
    const x0 = rect.x - rect.w * m, y0 = rect.y - rect.h * m, sx = (rect.w * (1 + 2 * m)) / outW, sy = (rect.h * (1 + 2 * m)) / outH;
    const nx = Math.max(1, Math.round(sx)), ny = Math.max(1, Math.round(sy));
    for (let y = 0; y < outH; y++) for (let x = 0; x < outW; x++) {
      let r = 0, g = 0, b = 0;
      for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
        const px = Math.min(w - 1, Math.max(0, Math.floor(x0 + (x + (i + 0.5) / nx) * sx))), py = Math.min(h - 1, Math.max(0, Math.floor(y0 + (y + (j + 0.5) / ny) * sy)));
        const o = (py * w + px) * 4; r += data[o]; g += data[o + 1]; b += data[o + 2];
      }
      const p = (y * outW + x) * 4, k = nx * ny; out[p] = r / k; out[p + 1] = g / k; out[p + 2] = b / k; out[p + 3] = 255;
    }
    return { width: outW, height: outH, data: out };
  }

  // How much is going on inside the middle of a pocket: an empty pocket (sleeve over the binder page) is flat.
  // Returns the standard deviation of brightness and of colour over the central 60%.
  function texture(img) {
    const { width: w, height: h, data } = img; let n = 0, s = 0, q = 0, cs = 0, cq = 0;
    for (let y = Math.round(h * 0.2); y < Math.round(h * 0.8); y += 2) for (let x = Math.round(w * 0.2); x < Math.round(w * 0.8); x += 2) {
      const o = (y * w + x) * 4, L = 0.299 * data[o] + 0.587 * data[o + 1] + 0.114 * data[o + 2], C = Math.max(data[o], data[o + 1], data[o + 2]) - Math.min(data[o], data[o + 1], data[o + 2]);
      n++; s += L; q += L * L; cs += C; cq += C * C;
    }
    const sd = (a, b) => Math.sqrt(Math.max(0, b / n - (a / n) ** 2));
    return { luma: sd(s, q), chroma: sd(cs, cq), mean: s / n };
  }
  // Below this the middle of the pocket is flat: nothing in it. Measured on synthetic pages (tools/pagescan_synth.py):
  // empty pockets 0.7–0.9, cards 10+ even in a dim room. To be checked against real binder photos.
  const EMPTY_LUMA = 5;

  // What to show for a pocket.
  //   ok      recognised and only one printing has this art: goes to the list as is (can still be changed)
  //   choose  recognised, but several printings share the art: the person picks (or OCR picks, later)
  //   check   a likely card, not sure enough: shown with suggestions, the person confirms or changes it
  //   unknown nothing close enough: the person searches for it or leaves the pocket out
  //   empty   no card in the pocket
  function classify(res, tex) {
    if (tex && tex.luma < EMPTY_LUMA) return "empty";
    if (!res) return "unknown";
    if (res.confident) return res.group.length > 1 ? "choose" : "ok";
    if (res.score >= 0.55) return "check";
    return "unknown";
  }

  // Same page photographed twice in a row (or the same nine cards again): the recognised ids in order.
  // A pocket whose art is shared by several printings counts by that group, not by the printing picked: the OCR may
  // settle it on one photo and not on the next (seen in CI, 24/11), and that must not hide a repeated page.
  const signature = (pockets) => pockets.map((p) => (p.status === "empty" && !p.id ? "-" : p.group && p.group.length > 1 ? p.group.slice().sort().join("|") : p.id || "?")).join(",");

  // The collector line ("29/204 · EN · 11", bottom left of the card) of a recognised pocket, as 4 corners in the photo,
  // so it can be cut out of the full-resolution photo for OCR. pocket.box: the card inside the pocket crop (fractions).
  function stripQuad(pocket, quad, pageW, pageH, M) {
    const c = pocket.cell, b = pocket.box; if (!c || !b) return null;
    const x0 = c.x - c.w * M, y0 = c.y - c.h * M, cw = c.w * (1 + 2 * M), ch = c.h * (1 + 2 * M);
    const card = { x: x0 + b.x * cw, y: y0 + b.y * ch, w: b.w * cw, h: b.h * ch };
    const s = { x: card.x + card.w * 0.01, y: card.y + card.h * 0.945, w: card.w * 0.34, h: card.h * 0.05 };
    const Hm = homography([[0, 0], [pageW, 0], [pageW, pageH], [0, pageH]], quad);
    return [[s.x, s.y], [s.x + s.w, s.y], [s.x + s.w, s.y + s.h], [s.x, s.y + s.h]].map(([u, v]) => apply(Hm, u, v));
  }

  // Default corners: the on-screen frame, in photo pixels.
  const frameQuad = (r) => [[r.x, r.y], [r.x + r.w, r.y], [r.x + r.w, r.y + r.h], [r.x, r.y + r.h]];

  // The whole page. identify(img) -> {id, score, gap, group, confident, top}. Yields between pockets so the screen
  // keeps drawing; onPocket(pocket, index) after each one. Returns { pockets, ms: {warp, recognise, total} }.
  // only: the pocket numbers to recognise (Escanear página shares the nine pockets between 2–3 Workers); the others are skipped.
  async function scanPage({ image, quad, layout = "3x3", identify, card = { W: 250, H: 350, M: 0.1 }, onPocket, yieldFn, only }) {
    const L = LAYOUTS[layout], t0 = now();
    const W = Math.round(L.cols * card.W), H = Math.round(L.rows * card.H);   // one pocket = one card at the fingerprint's size
    const page = warp(image, quad, W, H), t1 = now(), pockets = [];
    const oW = Math.round(card.W * (1 + 2 * card.M)), oH = Math.round(card.H * (1 + 2 * card.M));
    for (const c of cells(L, W, H)) {
      if (only && !only.includes(c.i)) continue;
      const img = crop(page, c, card.M, oW, oH), tex = texture(crop(page, c, 0, 60, 84));
      const res = tex.luma < EMPTY_LUMA ? null : identify(img);
      const status = classify(res, tex);
      const p = { i: c.i, r: c.r, c: c.c, status, id: res && status !== "empty" && status !== "unknown" ? res.id : null, score: res ? res.score : 0, gap: res ? res.gap : 0,
        group: res ? res.group : [], top: res ? res.top || [] : [], tex: Math.round(tex.luma * 10) / 10, box: res ? res.box || null : null, cell: c, luma: !!(res && res.lumaOnly) };
      pockets.push(p);
      onPocket?.(p, c.i);
      if (yieldFn) await yieldFn();
    }
    const t2 = now();
    return { pockets, page, ms: { warp: Math.round(t1 - t0), recognise: Math.round(t2 - t1), total: Math.round(t2 - t0) } };
  }
  const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());

  // A pocket still waiting for the person: a printing to pick, a guess to confirm, or a card to find (or leave out).
  const pending = (p) => !p.resolved && (p.status === "choose" || p.status === "check" || p.status === "unknown");
  // The cards a confirmed page adds: one entry per copy, as the one-card scanner's list keeps them.
  // Only pockets recognised for sure ("ok") or settled by the person; a doubtful guess never goes in by default.
  function toList(pockets) {
    if (pockets.some(pending)) throw new Error("pending pockets");
    const out = [];
    for (const p of pockets) if (p.id && !p.skip && (p.status === "ok" || p.resolved)) for (let k = 0; k < (p.qty ?? 1); k++) out.push({ id: p.id, foil: !!p.foil, lang: p.lang || null });
    return out;
  }

  // ---------- the collector line ("22/204 · EN · 13" = LOR13-22) ----------
  // Reprints, as the one-card scanner has always decided them (moved here unchanged so they can be tested): each reading's
  // numbers score the printings of the group; a printing is picked when it clearly leads.
  function collectorScores(text, group) {
    const toks = String(text || "").match(/\d+/g) || [];
    if (!toks.length) return [];
    const first = toks[0], nums = new Set([first, first.length > 3 ? first.slice(0, -3) : first]), last = toks[toks.length - 1];
    const score = (id) => { const m = id.match(/^LOR(\d+)-(\d+)$/); if (!m) return 0; let s = 0; if (nums.has(m[2]) || toks.includes(m[2])) s += 2; if (last === m[1]) s += 2; else if (toks.length > 1 && last.endsWith(m[1])) s += 1; return s; };
    return group.map((id) => [id, score(id)]).sort((a, b) => b[1] - a[1]);
  }
  function pickByCollector(text, group) {
    if (String(text).includes(" | ")) {   // several readings: add up each one's evidence
      const total = new Map(); for (const t of String(text).split(" | ")) for (const [id, sc] of collectorScores(t, group)) total.set(id, (total.get(id) || 0) + sc);
      const r = [...total].sort((a, b) => b[1] - a[1]); return r.length && r[0][1] >= 2 && r[0][1] >= (r[1]?.[1] ?? 0) + 2 ? r[0][0] : null;
    }
    const r = collectorScores(text, group);
    return r.length && r[0][1] >= 2 && r[0][1] >= (r[1]?.[1] ?? 0) + 2 ? r[0][0] : null;
  }
  // One reading, strictly: "number / printed total ... set". The total must be one a Lorcana set prints (200-210), the
  // number at most 260, the set 1-30. Anything else is not a reading (foil sparkle, the art's edge, a smudge).
  function parseCollector(text) {
    const t = String(text || "");
    // the number touches the "/" (spaces allowed), nothing but a separator before it: "12S/204" or "A125/204" is a corrupted
    // reading, not the number 12 or 125
    const m = /(?:^|[\s.·:;,|-])(\d{1,3})\s*\/\s*(\d{3})(?!\d)/.exec(t);
    if (!m) return null;
    const num = +m[1], total = +m[2];
    if (num < 1 || num > 260 || total < 200 || total > 210) return null;
    // the set: the next number after the total, past the language ("· EN ·"), within a few characters
    const rest = t.slice(m.index + m[0].length), sm = /^[^0-9]{1,8}?(\d+)/.exec(rest);
    if (sm && sm[1].length > 2) return null;   // "EN 113": a set number with three digits is a corrupted reading
    const set = sm ? +sm[1] : null;
    if (set != null && (set < 1 || set > 30)) return null;
    return { num, total, set };
  }
  // Escanear página: what the collector readings of one pocket settle. p: { status, id, group }, reads: the texts read from
  // the pocket's strip (up to three images of it), has(id): the card exists in the catalogue.
  //   { pick: id }      the pocket is settled without the person
  //   { suggest: id }   that card goes first; the person confirms
  //   null              nothing usable, or the readings are ambiguous: the pocket stays as the art left it
  // Conselho 26/11: an ambiguous reading must never settle a pocket.
  //   - Every reading that names a card must name the same card; two readings naming different cards: nothing.
  //   - The set must have been read: a number alone fits several printings ("163" is Let It Go in set 1 and in set 11).
  //   - Near misses: when another card the art pointed to differs from the one read by a dropped digit ("EN 1" for "EN 11",
  //     "63" for "163") or one easily confused digit (5↔6, 3↔8, 1↔7, 0↔8), the reading is ambiguous. Only the art's cards
  //     count: every set has a number 55, but only a reprint of the same art can be in this pocket.
  //   - Reprints ("choose"): the card named must be one of the printings the art pointed to; a real card outside them
  //     means the art and the number disagree: nothing.
  //   - A pocket the art didn't settle ("check" / "unknown"): settled only when the number names the very card the art put
  //     first (two independent clues agree). A number naming another card, however clear, is only a suggestion: the three
  //     images of one strip are not independent readings, a smudged digit (5↔6, 3↔8) repeats in all of them.
  const CONFUSED = new Set(["56", "65", "38", "83", "17", "71", "08", "80", "69", "96"]);
  function decideNumber(p, reads, has) {
    const parsed = reads.map(parseCollector).filter(Boolean);
    if (!parsed.length) return null;
    const art = new Set([p.id, ...(p.group || []), ...(p.top || []).map((t) => (t && t.id) || t)].filter(Boolean));
    const near = (a, b) => { a = String(a); b = String(b); if (a === b) return true;
      if (Math.abs(a.length - b.length) === 1 && (a.length < b.length ? b.includes(a) : a.includes(b))) return true;   // a digit dropped or added
      if (a.length !== b.length) return false; let d = 0, ok = true;
      for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) { d++; ok = ok && CONFUSED.has(a[i] + b[i]); }
      return d === 1 && ok; };
    const ambiguous = (r, id) => [...art].some((c) => { if (c === id) return false; const m = /^LOR(\d+)-(\d+)$/.exec(c); return m && near(r.set, m[1]) && near(r.num, m[2]); });
    const named = new Set();
    for (const r of parsed) {
      if (r.set == null) continue;                    // weighed below: it must not contradict the card named
      const id = `LOR${r.set}-${r.num}`;
      if (!has(id) || ambiguous(r, id)) return null;  // no such card, or a near miss of another card the art pointed to
      named.add(id);
    }
    if (named.size !== 1) return null;                // none with its set, or readings naming different cards
    const id = [...named][0], num = +id.split("-")[1];
    if (parsed.some((r) => r.set == null && r.num !== num)) return null;   // a reading without set, with another number
    if (p.status === "choose") return (p.group || []).includes(id) ? { pick: id } : null;
    if (p.status !== "check" && p.status !== "unknown") return null;
    return id === p.id ? { pick: id } : { suggest: id };
  }

  const API = { LAYOUTS, homography, apply, validQuad, warp, cells, cellQuads, crop, texture, EMPTY_LUMA, classify, signature, frameQuad, stripQuad, scanPage, pending, toList,
    collectorScores, pickByCollector, parseCollector, decideNumber };
  return API;
  }
  const API = factory();
  root.INKWELL_PAGESCAN_FACTORY = factory;   // the Escanear página Worker is built from this source
  root.INKWELL_PAGESCAN = API;
  if (typeof module !== "undefined" && module.exports) module.exports = API;
})(typeof window !== "undefined" ? window : globalThis);
