// node tools/stillcapture.test.mjs — Escanear página with a real photo: the video frame found inside it (src/site/stillcapture.js)
await import('../src/site/stillcapture.js');   // sets globalThis.INKWELL_STILL, as on the page
const ST = globalThis.INKWELL_STILL;
let n = 0, bad = 0;
const ok = (c, msg) => { n++; if (!c) { bad++; console.log('FAIL', msg); } };
// --- alignStill: the video frame the person saw, found inside the real photo (26/11)
{
  // a smooth "scene": random blobs, 1600 × 1200 (a 4:3 photo)
  const PWd = 1600, PHd = 1200, sc = new Uint8ClampedArray(PWd * PHd * 4); let seed = 7; const rnd = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 2 ** 32);
  const blobs = Array.from({ length: 40 }, () => [rnd() * PWd, rnd() * PHd, 40 + rnd() * 160, rnd() * 255, rnd() * 255, rnd() * 255]);
  for (let y = 0; y < PHd; y++) for (let x = 0; x < PWd; x++) { let r = 60, g = 60, b = 60;
    for (const [cx, cy, rad, R, G, B] of blobs) { const w = Math.exp(-((x - cx) ** 2 + (y - cy) ** 2) / (2 * rad * rad)); r += (R - r) * w; g += (G - g) * w; b += (B - b) * w; }
    const o = (y * PWd + x) * 4; sc[o] = r; sc[o + 1] = g; sc[o + 2] = b; sc[o + 3] = 255; }
  const scene = { width: PWd, height: PHd, data: sc };
  // frame = the part of the photo at (ox, oy) with s photo pixels per frame pixel
  const frameOf = (fw, fh, s, ox, oy) => { const d = new Uint8ClampedArray(fw * fh * 4);
    for (let y = 0; y < fh; y++) for (let x = 0; x < fw; x++) { const px = Math.min(PWd - 1, Math.round(ox + (x + 0.5) * s)), py = Math.min(PHd - 1, Math.round(oy + (y + 0.5) * s)), i = (py * PWd + px) * 4, o = (y * fw + x) * 4;
      d[o] = sc[i]; d[o + 1] = sc[i + 1]; d[o + 2] = sc[i + 2]; d[o + 3] = 255; }
    return { width: fw, height: fh, data: d }; };
  const quad = [[200, 60], [440, 60], [440, 300], [200, 300]];   // a page drawn on a 640 × 360 frame
  for (const [name, s, ox, oy] of [["16:9 video, centred crop of a 4:3 photo", 2.5, 0, 150], ["off centre and 4% zoomed (lens switch)", 2.4, 70, 140], ["a little shifted", 2.5, 18, 130]]) {
    const fr = frameOf(640, 360, s, ox, oy), a = ST.alignStill(fr, scene), got = ST.mapQuad(quad, a), want = quad.map(([x, y]) => [ox + x * s, oy + y * s]);
    const err = Math.max(...got.map((p, i) => Math.hypot(p[0] - want[i][0], p[1] - want[i][1]))) / (240 * s) * 100;
    ok(a.corr > 0.9 && err < 1.5, `alignStill: ${name} (corr ${a.corr.toFixed(2)}, corner error ${err.toFixed(2)}% of the page)`);
  }
  const other = { width: 640, height: 360, data: new Uint8ClampedArray(640 * 360 * 4).map((_, i) => (i % 4 === 3 ? 255 : ((i * 2654435761) >>> 24))) };
  ok(ST.alignStill(other, scene).corr < 0.6, 'alignStill: a frame that is not in the photo does not line up');
}

console.log(`${n - bad}/${n} stillcapture checks passed`);
if (bad) process.exit(1);
