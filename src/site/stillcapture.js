// Escanear página: a real photo instead of a frame of the video (26/11). Pure functions, shared by the page
// (colecao.template.html, ?captura=foto and the A3 measurement) and the unit tests (tools/stillcapture.test.mjs).
//   STILL.alignStill(frame, photo) -> { s, ox, oy, corr }    the video frame the person framed, found inside the photo
//   STILL.mapQuad(quad, a)                                   corners drawn on the video frame, in the photo's pixels
// frame, photo: { width, height, data } RGBA.
(function (root) {
  "use strict";
  // A real photo (ImageCapture.takePhoto; off by default, see colecao: PHOTO_ON) instead of a frame of the video: more pixels and the camera's own
  // processing. The photo may not cover exactly what the video showed (a 4:3 sensor behind a 16:9 video, a lens switch),
  // so the video frame the person saw is located inside the photo: photo = offset + frame × scale.
  // Start from "same centre, the frame a centred crop of the photo", then search scale and offset on small grey copies
  // for the best correlation. Returns { s, ox, oy, corr }; corr below ~0.6 means it didn't line up: keep the video frame.
  function grey(img, maxSide) {
    const k = Math.min(1, maxSide / Math.max(img.width, img.height)), w = Math.max(4, Math.round(img.width * k)), h = Math.max(4, Math.round(img.height * k));
    const g = new Float32Array(w * h), st = 1 / k, { data, width: W0, height: H0 } = img;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      let s = 0, n = 0; const x0 = Math.floor(x * st), y0 = Math.floor(y * st), x1 = Math.min(W0, Math.max(x0 + 1, Math.floor((x + 1) * st))), y1 = Math.min(H0, Math.max(y0 + 1, Math.floor((y + 1) * st)));
      const sx = Math.max(1, (x1 - x0) >> 2), sy = Math.max(1, (y1 - y0) >> 2);
      for (let yy = y0; yy < y1; yy += sy) for (let xx = x0; xx < x1; xx += sx) { const o = (yy * W0 + xx) * 4; s += 0.299 * data[o] + 0.587 * data[o + 1] + 0.114 * data[o + 2]; n++; }
      g[y * w + x] = s / n;
    }
    return { g, w, h, k };
  }
  function alignStill(frame, photo) {
    const F = grey(frame, 96), P = grey(photo, 480);
    const s0 = Math.min(photo.width / frame.width, photo.height / frame.height);
    const ox0 = (photo.width - frame.width * s0) / 2, oy0 = (photo.height - frame.height * s0) / 2;
    let fm = 0; for (const v of F.g) fm += v; fm /= F.g.length; let fq = 0; for (const v of F.g) fq += (v - fm) ** 2; fq = Math.sqrt(fq) || 1;
    const samp = (x, y) => { x = Math.max(0, Math.min(P.w - 1.001, x)); y = Math.max(0, Math.min(P.h - 1.001, y)); const xi = x | 0, yi = y | 0, ax = x - xi, ay = y - yi, o = yi * P.w + xi;
      return (P.g[o] * (1 - ax) + P.g[o + 1] * ax) * (1 - ay) + (P.g[o + P.w] * (1 - ax) + P.g[o + P.w + 1] * ax) * ay; };
    const v = new Float32Array(F.g.length);
    function corr(s, ox, oy) {   // s, ox, oy in photo pixels per frame pixel / photo pixels
      let m = 0, i = 0;
      for (let y = 0; y < F.h; y++) for (let x = 0; x < F.w; x++) { const px = (ox + ((x + 0.5) / F.k) * s) * P.k - 0.5, py = (oy + ((y + 0.5) / F.k) * s) * P.k - 0.5; v[i] = samp(px, py); m += v[i++]; }
      m /= v.length; let q = 0, d = 0; for (let j = 0; j < v.length; j++) { const a = v[j] - m; q += a * a; d += a * (F.g[j] - fm); }
      return d / ((Math.sqrt(q) || 1) * fq);
    }
    let best = { s: s0, ox: ox0, oy: oy0, corr: corr(s0, ox0, oy0) };
    const span = Math.max(photo.width, photo.height);
    // scale ±12% and offset ±6% first, in steps no wider than the detail of the small copies, then finer around the best
    for (const [ds, sa, dd, sb] of [[0.02, 6, 0.01, 6], [0.006, 2, 0.003, 2], [0.002, 2, 0.001, 2]]) {
      const c = best;
      for (let a = -sa; a <= sa; a++) for (let b = -sb; b <= sb; b++) for (let e = -sb; e <= sb; e++) {
        const s = c.s * (1 + a * ds), fw = frame.width * s, fh = frame.height * s;
        const ox = c.ox + (c.s - s) * frame.width / 2 + b * dd * span, oy = c.oy + (c.s - s) * frame.height / 2 + e * dd * span;   // scale about the frame's centre
        if (ox < -0.02 * span || oy < -0.02 * span || ox + fw > photo.width + 0.02 * span || oy + fh > photo.height + 0.02 * span) continue;
        const r = corr(s, ox, oy); if (r > best.corr) best = { s, ox, oy, corr: r };
      }
    }
    return best;
  }
  // A quad drawn on the video frame, in the photo's pixels.
  const mapQuad = (q, a) => q.map(([x, y]) => [a.ox + x * a.s, a.oy + y * a.s]);

  const API = { alignStill, mapQuad, grey };
  root.INKWELL_STILL = API;
  if (typeof module !== "undefined" && module.exports) module.exports = API;
})(typeof window !== "undefined" ? window : globalThis);
