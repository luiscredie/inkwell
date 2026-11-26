// Scanner 2.0, A3 — comparação controlada vídeo × foto (docs/scanner-2.0-avaliacao.md, seção 6).
//
// The site, opened with ?medicao=a3, offers one JSON per page shot ("Baixar medição", format a3: 2): the video frame and
// the photo of the same instant and framing, what the scanner read in each pocket from each (and, where the engine has
// the experimental glare filter, from each again with it), resolutions, times, alignment and fallback. This scores every
// reading against the same gabarito with the procedure's own definitions (tools/pagescan-report.mjs: verdict, summarise),
// so "automática certa", "falso positivo" etc. mean exactly what they mean in the rest of A3.
//
//   node tools/pagescan-a3-compare.mjs extract DIR              writes DIR/<name>-foto.jpg and -video.jpg to annotate
//                                                               (tools/pagescan-annotate.html; export truth.json into DIR)
//   node tools/pagescan-a3-compare.mjs report DIR [OUT.json] [OUT.md]
//
// The pictures are a person's own binder: they stay on the computer that measures, outside the repository (.gitignore
// ignores their names). Only the aggregated report goes to the PR.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { verdict, summarise } from './pagescan-report.mjs';

// the readings compared, in the order they are shown; "site" is what the person's page used (video unless ?captura=foto)
export const MODES = ['video', 'foto', 'video+reflexo', 'foto+reflexo', 'site'];
const PAIRS = [['foto', 'video', 'Foto × vídeo'], ['video+reflexo', 'video', 'Filtro de reflexo × sem (vídeo)'], ['foto+reflexo', 'foto', 'Filtro de reflexo × sem (foto)']];

export const pageName = (file) => String(file).replace(/-(foto|video)\.jpe?g$/i, '');
const captureMs = (rec, from) => (from === 'video' ? rec.times.frameMs : rec.times.frameMs + (rec.times.stillMs || 0) + (rec.times.alignMs || 0));

// one row per pocket, per reading, in tools/pagescan-report.mjs's shape; device_s = the whole time on the phone for that
// reading: capture (video: the frame; photo: frame + takePhoto + alignment) + engine + collector numbers
export function rows(recs, truth) {
  const T = new Map((truth.pages || []).map((p) => [pageName(p.file), p])), out = [];
  for (const rec of recs) {
    const t = T.get(rec.name); if (!t) continue;
    for (const k of MODES) {
      const m = k === 'site' ? rec.modes[rec.used] : rec.modes[k];
      if (!m || !Array.isArray(m.pockets)) continue;
      const from = k === 'site' ? rec.used : m.from || k.split('+')[0];
      const device_s = Math.round((captureMs(rec, from) + (m.engineMs || 0) + (m.ocrMs || 0)) / 100) / 10;
      m.pockets.forEach((p, i) => out.push({ file: rec.name, mode: k, device: t.device || '?', os: t.os || '', cond: t.light || t.cond || '', i,
        truth: t.cards[i] || null, status: p.status, id: p.id || null, group: p.group || [], top: (p.top || []).map((id) => (typeof id === 'string' ? { id } : id)),
        desktop_ms: null, device_s }));
    }
  }
  for (const x of out) x.v = verdict(x);
  return out;
}

// exact McNemar: two-sided binomial on the discordant pockets
export function mcnemar(b, c) {
  const n = b + c; if (!n) return 1;
  let p = 0; for (let i = 0; i <= Math.min(b, c); i++) { let k = 1; for (let j = 0; j < i; j++) k = (k * (n - j)) / (j + 1); p += k / 2 ** n; }
  return Math.min(1, Math.round(2 * p * 1000) / 1000);
}
const identified = (v) => v === 'auto-right' || v === 'first-right';
export function paired(all, a, b) {
  const key = (x) => `${x.file}#${x.i}`, B = new Map(all.filter((x) => x.mode === b).map((x) => [key(x), x]));
  const both = all.filter((x) => x.mode === a && B.has(key(x)));
  const cards = both.filter((x) => x.truth);
  const aOnly = cards.filter((x) => identified(x.v) && !identified(B.get(key(x)).v)).length, bOnly = cards.filter((x) => !identified(x.v) && identified(B.get(key(x)).v)).length;
  const fpA = both.filter((x) => x.v === 'false-positive' && B.get(key(x)).v !== 'false-positive').length, fpB = both.filter((x) => x.v !== 'false-positive' && B.get(key(x)).v === 'false-positive').length;
  const wrongSugA = cards.filter((x) => x.status === 'check' && x.id !== x.truth && !(B.get(key(x)).status === 'check' && B.get(key(x)).id !== x.truth)).length;
  const wrongSugB = cards.filter((x) => { const y = B.get(key(x)); return y.status === 'check' && y.id !== x.truth && !(x.status === 'check' && x.id !== x.truth); }).length;
  return { a, b, pockets: both.length, cards: cards.length, a_only_identified: aOnly, b_only_identified: bOnly, p: mcnemar(aOnly, bOnly),
    false_positive_a_only: fpA, false_positive_b_only: fpB, wrong_suggestion_a_only: wrongSugA, wrong_suggestion_b_only: wrongSugB,
    // evidence of a gain, as section 6.4 asks: a identifies more with p < 0.05 and makes no more false positives
    gain: cards.length > 0 && aOnly > bOnly && mcnemar(aOnly, bOnly) < 0.05 && fpA <= fpB };
}

const median = (a) => { const s = a.filter((v) => typeof v === 'number' && isFinite(v)).sort((p, q) => p - q); return s.length ? s[Math.floor(s.length / 2)] : null; };
export function capture(recs) {
  const n = recs.length, cnt = (f) => recs.filter(f).length, reasons = {};
  for (const r of recs) if (r.used !== 'foto') reasons[r.fallback || '?'] = (reasons[r.fallback || '?'] || 0) + 1;
  return { pages: n, photo_taken: cnt((r) => !!r.modes.foto), aligned: cnt((r) => r.aligned), used_photo: cnt((r) => r.used === 'foto'), used_video: cnt((r) => r.used !== 'foto'),
    fallback_reasons: reasons, align_median: median(recs.map((r) => r.align)), align_min: recs.reduce((m, r) => (typeof r.align === 'number' && (m == null || r.align < m) ? r.align : m), null),
    video_px: [...new Set(recs.map((r) => r.modes.video?.px).filter(Boolean))], photo_px: [...new Set(recs.map((r) => r.modes.foto?.px).filter(Boolean))],
    photo_kept: [...new Set(recs.map((r) => r.modes.foto?.kept).filter(Boolean))],
    still_ms_median: median(recs.map((r) => r.times.stillMs)), align_ms_median: median(recs.map((r) => r.times.alignMs)),
    ready_ms_median: median(recs.map((r) => r.seen?.ready)), numbers_step: recs.every((r) => Object.values(r.modes).every((m) => !m || m.numbers)),
    devices: [...new Set(recs.map((r) => r.ua))].length };
}

export function compare(recs, truth) {
  recs = recs.filter((r) => r && r.a3 === 2);
  const T = new Set((truth.pages || []).map((p) => pageName(p.file)));
  const scored = recs.filter((r) => T.has(r.name)), missing = recs.filter((r) => !T.has(r.name)).map((r) => r.name);
  const all = rows(scored, truth), modes = MODES.filter((k) => all.some((x) => x.mode === k));
  const devices = [...new Set(all.map((x) => x.device))];
  return {
    a3: 'video-x-foto', photos: truth.real ? 'real' : 'synthetic', missing_truth: missing, capture: capture(scored),
    modes: Object.fromEntries(modes.map((k) => [k, summarise(all.filter((x) => x.mode === k))])),
    by_device: Object.fromEntries(devices.map((d) => [d, Object.fromEntries(modes.map((k) => [k, summarise(all.filter((x) => x.mode === k && x.device === d))]))])),
    paired: PAIRS.filter(([a, b]) => modes.includes(a) && modes.includes(b)).map(([a, b, label]) => ({ label, ...paired(all, a, b) })),
    pockets: all.map(({ file, mode, device, i, truth: t, status, id, v }) => ({ file, mode, device, i, truth: t, status, id, v })),
  };
}

export function markdown(r) {
  const ms = Object.keys(r.modes), c = r.capture, f = (v, s = '') => (v == null ? '–' : `${v}${s}`);
  const line = (label, g) => `| ${label} | ${ms.map((k) => g(r.modes[k])).join(' | ')} |`;
  return [
    `**A3 — vídeo × foto.** Fotos: ${r.photos === 'real' ? 'reais' : 'sintéticas (não valem como resultado do produto)'} · ${c.pages} páginas${r.missing_truth.length ? ` (${r.missing_truth.length} sem gabarito)` : ''}`,
    '',
    `Captura: foto tirada em ${c.photo_taken}/${c.pages}, alinhada em ${c.aligned}, usada pela página em ${c.used_photo}; vídeo em ${c.used_video}${Object.keys(c.fallback_reasons).length ? ' (' + Object.entries(c.fallback_reasons).map(([k, n]) => `${k}: ${n}`).join('; ') + ')' : ''}.`,
    `Resolução: vídeo ${c.video_px.join(', ') || '–'}; foto ${c.photo_px.join(', ') || '–'} (mantida ${c.photo_kept.join(', ') || '–'}). Alinhamento: mediana ${f(c.align_median)}, mínimo ${f(c.align_min)}. takePhoto ${f(c.still_ms_median, ' ms')}, alinhar ${f(c.align_ms_median, ' ms')} (medianas).`,
    c.numbers_step ? '' : '_A leitura do número de colecionador não estava disponível nesta versão do site: os números abaixo são só da arte._',
    '',
    `| | ${ms.map((k) => (k === 'site' ? 'Site (o que a página usou)' : k)).join(' | ')} |`, `|---|${ms.map(() => '---').join('|')}|`,
    line('Automática certa', (s) => f(s.auto_right_pct, '%')), line('1ª sugestão certa', (s) => f(s.first_right_pct, '%')), line('Correção manual', (s) => f(s.manual_pct, '%')),
    line('Identificação', (s) => f(s.identified_pct, '%')), line('**Falso positivo**', (s) => f(s.false_positive)), line('Carta tomada por vazio', (s) => f(s.card_as_empty)),
    line('Tempo no aparelho, mediana / máx.', (s) => `${f(s.device_s_median)} / ${f(s.device_s_max)} s`),
    '',
    ...r.paired.map((p) => `- **${p.label}** (${p.cards} cartas): só ${p.a} identificou ${p.a_only_identified}, só ${p.b} ${p.b_only_identified} (McNemar exato p = ${p.p}); falso positivo só em ${p.a}: ${p.false_positive_a_only}, só em ${p.b}: ${p.false_positive_b_only}; sugestão errada só em ${p.a}: ${p.wrong_suggestion_a_only}, só em ${p.b}: ${p.wrong_suggestion_b_only}. **${p.gain ? 'Evidência de ganho' : 'Sem evidência de ganho'}.**`),
  ].filter((l, i, a) => !(l === '' && a[i - 1] === '')).join('\n');
}

// CLI
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const [cmd, DIR, OUT, MD] = process.argv.slice(2);
  if (!['extract', 'report'].includes(cmd) || !DIR) { console.error('usage: node tools/pagescan-a3-compare.mjs extract|report DIR [OUT.json] [OUT.md]'); process.exit(2); }
  const recs = fs.readdirSync(DIR).filter((f) => /^a3-p.*\.json$/.test(f) && !/relatorio/.test(f)).sort().map((f) => JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8'))).filter((r) => r.a3 === 2);
  if (!recs.length) { console.error(`no A3 measurement (a3-p*.json, format 2) in ${DIR}`); process.exit(2); }
  if (cmd === 'extract') {
    for (const r of recs) for (const [k, url] of Object.entries(r.pictures || {})) fs.writeFileSync(path.join(DIR, `${r.name}-${k}.jpg`), Buffer.from(url.split(',')[1], 'base64'));
    console.log(`${recs.length} páginas: anote as -foto.jpg (ou a -video.jpg de uma página sem foto) em tools/pagescan-annotate.html e exporte o truth.json para ${DIR}`);
  } else {
    const r = compare(recs, JSON.parse(fs.readFileSync(path.join(DIR, 'truth.json'), 'utf8'))), md = markdown(r);
    if (OUT) fs.writeFileSync(OUT, JSON.stringify(r, null, 1));
    if (MD) fs.writeFileSync(MD, md + '\n');
    console.log(md);
  }
}
