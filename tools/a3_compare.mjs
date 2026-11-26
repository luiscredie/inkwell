// A3 — controlled comparison of video frame vs photo (docs/scanner-2.0-avaliacao.md §6).
//
// The site, opened with ?medicao=a3, saves one JSON per page shot ("Baixar medição"): the video frame and the photo of the
// same instant and framing, the scanner's corners for each, resolutions, times, alignment, fallback, and what the scanner
// read in each pocket from each picture. This script scores both against the same gabarito.
//
//   node tools/a3_compare.mjs extract DIR        writes DIR/<name>-foto.jpg (or -video.jpg when there is no photo) to annotate
//                                                with tools/pagescan-annotate.html; its truth.json goes in DIR
//   node tools/a3_compare.mjs report DIR [OUT]   prints the comparison (Markdown) and writes OUT (JSON) if given
//
// The pictures stay local (own collection); only the aggregated report goes to the PR.
import fs from 'node:fs';
import path from 'node:path';

const [cmd, DIR, OUT] = process.argv.slice(2);
if (!cmd || !DIR) { console.error('usage: node tools/a3_compare.mjs extract|report DIR [OUT.json]'); process.exit(2); }
const recs = fs.readdirSync(DIR).filter((f) => /^a3-.*\.json$/.test(f)).sort().map((f) => JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8'))).filter((r) => r.a3 === 1);
if (!recs.length) { console.error(`no a3-*.json in ${DIR}`); process.exit(2); }

if (cmd === 'extract') {
  for (const r of recs) for (const k of ['foto', 'video']) {
    const m = r.modes[k]; if (!m?.jpeg) continue;
    fs.writeFileSync(path.join(DIR, `${r.name}-${k}.jpg`), Buffer.from(m.jpeg.split(',')[1], 'base64'));
  }
  console.log(`${recs.length} pages: annotate the -foto.jpg files (the -video.jpg of a page without photo) in tools/pagescan-annotate.html, export truth.json into ${DIR}`);
  process.exit(0);
}
if (cmd !== 'report') { console.error(`unknown command ${cmd}`); process.exit(2); }

// gabarito: truth.json from the annotate tool, one entry per page (either picture of it)
const truth = JSON.parse(fs.readFileSync(path.join(DIR, 'truth.json'), 'utf8'));
const T = new Map(truth.pages.map((p) => [p.file.replace(/-(foto|video)\.jpg$/i, ''), p]));

// same categories as tools/pagescan-bench.spec.mjs
const verdict = (x) => {
  if (!x.truth) return x.status === 'empty' ? 'empty-right' : x.status === 'ok' ? 'false-positive' : 'empty-asked';
  if (x.status === 'empty') return 'card-as-empty';
  if (x.status === 'ok') return x.id === x.truth ? 'auto-right' : 'false-positive';
  if (x.id === x.truth) return 'first-right';
  if ((x.group || []).includes(x.truth) || (x.top || []).includes(x.truth)) return 'alt-right';
  return 'not-offered';
};
const captureMs = (r, k) => (k === 'video' ? r.times.frameMs : r.times.frameMs + (r.times.stillMs || 0) + (r.times.alignMs || 0));
const median = (a) => { const s = a.filter((v) => v != null).sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : null; };
const p90 = (a) => { const s = a.filter((v) => v != null).sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.ceil(s.length * 0.9) - 1)] : null; };

const missing = recs.filter((r) => !T.has(r.name)).map((r) => r.name);
const pages = recs.filter((r) => T.has(r.name));
const rows = [];   // one per page × mode × pocket
for (const r of pages) {
  const t = T.get(r.name), dev = t.device || '?', cond = t.cond || '';
  for (const k of ['video', 'foto', 'site']) {
    const mk = k === 'site' ? r.used : k, m = r.modes[mk];
    if (!m || !m.pockets) continue;
    m.pockets.forEach((p, i) => rows.push({ page: r.name, mode: k, device: dev, cond, i, truth: t.cards[i] || null, ...p, v: verdict({ ...p, truth: t.cards[i] || null }),
      ms: captureMs(r, mk) + (m.engineMs || 0) + (m.ocrMs || 0) }));
  }
}
const sum = (list) => {
  const cards = list.filter((x) => x.truth), n = cards.length, c = (v) => list.filter((x) => x.v === v).length, pct = (k) => (n ? Math.round((1000 * k) / n) / 10 : null);
  const perPage = [...new Map(list.map((x) => [x.page, x.ms])).values()];
  return {
    pages: perPage.length, cards: n, empty_pockets: list.length - n,
    identified_pct: pct(c('auto-right') + c('first-right')), auto_right_pct: pct(c('auto-right')), first_right_pct: pct(c('first-right')),
    alt_right_pct: pct(c('alt-right')), not_offered_pct: pct(c('not-offered')),
    false_positive: c('false-positive'), card_as_empty: c('card-as-empty'), empty_right: c('empty-right'), empty_asked: c('empty-asked'),
    within_reach_pct: pct(c('auto-right') + c('first-right') + c('alt-right')), needs_person_pct: pct(cards.filter((x) => x.status !== 'ok').length),
    total_ms_median: median(perPage), total_ms_p90: p90(perPage),
  };
};
const by = (mode) => rows.filter((x) => x.mode === mode);
const devices = [...new Set(rows.map((x) => x.device))];
// paired: same pocket, both pictures. "identified" = the card the scanner puts first is right.
const ident = (v) => v === 'auto-right' || v === 'first-right';
const key = (x) => `${x.page}#${x.i}`, V = new Map(by('video').map((x) => [key(x), x])), paired = by('foto').filter((x) => x.truth && V.has(key(x)));
const pair = { pockets: paired.length, foto_only: paired.filter((x) => ident(x.v) && !ident(V.get(key(x)).v)).length, video_only: paired.filter((x) => !ident(x.v) && ident(V.get(key(x)).v)).length,
  fp_foto_only: paired.filter((x) => x.v === 'false-positive' && V.get(key(x)).v !== 'false-positive').length, fp_video_only: paired.filter((x) => x.v !== 'false-positive' && V.get(key(x)).v === 'false-positive').length };
// exact McNemar (two-sided binomial on the discordant pockets): how likely a difference this lopsided is by chance
const binom = (k, n) => { if (!n) return 1; let p = 0; const lo = Math.min(k, n - k); for (let i = 0; i <= lo; i++) { let c = 1; for (let j = 0; j < i; j++) c = (c * (n - j)) / (j + 1); p += c / 2 ** n; } return Math.min(1, 2 * p); };
pair.mcnemar_p = Math.round(binom(pair.foto_only, pair.foto_only + pair.video_only) * 1000) / 1000;

const capture = {
  pages: pages.length, photo_taken: pages.filter((r) => r.modes.foto).length, aligned: pages.filter((r) => r.aligned).length,
  used_photo: pages.filter((r) => r.used === 'foto').length, fallback: pages.filter((r) => r.used !== 'foto').length,
  fallback_reasons: pages.filter((r) => r.used !== 'foto').reduce((o, r) => ({ ...o, [r.fallback || '?']: (o[r.fallback || '?'] || 0) + 1 }), {}),
  align_median: median(pages.map((r) => r.align)), align_min: pages.reduce((m, r) => (r.align != null && (m == null || r.align < m) ? r.align : m), null),
  video_px: [...new Set(pages.map((r) => r.modes.video?.px))], photo_px: [...new Set(pages.map((r) => r.modes.foto?.px).filter(Boolean))],
  still_ms_median: median(pages.map((r) => r.times.stillMs)), align_ms_median: median(pages.map((r) => r.times.alignMs)),
};
const report = { a3: 'video-vs-foto', created: new Date().toISOString(), missing_truth: missing, capture, pair,
  all: { video: sum(by('video')), foto: sum(by('foto')), site: sum(by('site')) },
  by_device: Object.fromEntries(devices.map((d) => [d, { video: sum(by('video').filter((x) => x.device === d)), foto: sum(by('foto').filter((x) => x.device === d)), site: sum(by('site').filter((x) => x.device === d)) }])),
  verdicts: rows.map(({ page, mode, i, truth: t, status, id, v }) => ({ page, mode, i, truth: t, status, id, v })) };
if (OUT) fs.writeFileSync(OUT, JSON.stringify(report, null, 1));

// Markdown for the PR
const line = (label, f) => `| ${label} | ${['video', 'foto', 'site'].map((k) => f(report.all[k]) ?? '–').join(' | ')} |`;
const md = [
  `## A3 — vídeo × foto (${pages.length} páginas${missing.length ? `, ${missing.length} sem gabarito` : ''})`, '',
  `Captura: foto tirada em ${capture.photo_taken}/${pages.length}, alinhada em ${capture.aligned}, usada em ${capture.used_photo}; fallback ${capture.fallback}${capture.fallback ? ' (' + Object.entries(capture.fallback_reasons).map(([k, n]) => `${k}: ${n}`).join('; ') + ')' : ''}.`,
  `Resolução: vídeo ${capture.video_px.join(', ')}; foto ${capture.photo_px.join(', ') || '–'}. Alinhamento: mediana ${capture.align_median ?? '–'}, mínimo ${capture.align_min ?? '–'}.`, '',
  '| Por posição | Vídeo | Foto | Site (o que foi usado) |', '|---|---|---|---|',
  line('Identificação (%)', (s) => s.identified_pct), line('Automática certa (%)', (s) => s.auto_right_pct), line('1ª sugestão certa (%)', (s) => s.first_right_pct),
  line('Ao alcance (%)', (s) => s.within_reach_pct), line('**Falsos positivos**', (s) => s.false_positive), line('Carta tomada por vazio', (s) => s.card_as_empty),
  line('Precisa da pessoa (%)', (s) => s.needs_person_pct), line('Tempo total, mediana (ms)', (s) => s.total_ms_median), line('Tempo total, p90 (ms)', (s) => s.total_ms_p90), '',
  `Pareado (${pair.pockets} posições com carta): só a foto acertou ${pair.foto_only}, só o vídeo ${pair.video_only} (McNemar exato p = ${pair.mcnemar_p}); falso positivo só na foto ${pair.fp_foto_only}, só no vídeo ${pair.fp_video_only}.`,
  '', 'Tempo total = captura (vídeo: quadro; foto: quadro + takePhoto + alinhamento) + motor + leitura dos números. Medido pelo site no aparelho.',
].join('\n');
console.log(md);
