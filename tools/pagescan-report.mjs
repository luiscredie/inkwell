// Scanner 2.0, evaluation A3 (docs/scanner-2.0-avaliacao.md): from the scanner's answer for every pocket of an annotated
// photo set to the report. Pure functions, shared by tools/pagescan-bench.spec.mjs (the real run), the procedure check
// (tools/pagescan-a3.spec.mjs) and the unit tests (tools/pagescan-report.test.mjs).
//
// A row is one pocket: { file, device, where, cond, i, truth (card id | null), status, id, group, top, desktop_ms, device_s }.

// One verdict per pocket:
//   auto-right       recognised alone and right: nothing for the person to do
//   false-positive   recognised alone but wrong card, or a card "found" in an empty pocket: the dangerous case
//   first-right      the person is asked, and the first answer offered (suggestion / printing) is right: one tap
//   alt-right        the person is asked, the right card is among the other suggestions or printings
//   not-offered      the right card is not offered: the person must search by name
//   card-as-empty    a card read as an empty pocket: left out (the screen says so) unless the person looks
//   empty-right / empty-asked   an empty pocket read as empty / sent to the person
export function verdict(x) {
  if (!x.truth) return x.status === 'empty' ? 'empty-right' : x.status === 'ok' ? 'false-positive' : 'empty-asked';
  if (x.status === 'empty') return 'card-as-empty';
  if (x.status === 'ok') return x.id === x.truth ? 'auto-right' : 'false-positive';
  if (x.id === x.truth) return 'first-right';
  // top: the engine's candidates, as objects {id, score} (bench) or as ids (the site's A3 record, §6)
  if ((x.group || []).includes(x.truth) || (x.top || []).some((t) => (t && typeof t === 'object' ? t.id : t) === x.truth)) return 'alt-right';
  return 'not-offered';
}

const median = (a) => { const s = a.filter((v) => typeof v === 'number' && isFinite(v)).sort((p, q) => p - q); return s.length ? s[Math.floor(s.length / 2)] : null; };
const max = (a) => { const s = a.filter((v) => typeof v === 'number' && isFinite(v)); return s.length ? Math.max(...s) : null; };

export function summarise(rows) {
  const cards = rows.filter((x) => x.truth), n = cards.length;
  const c = (v) => rows.filter((x) => x.v === v).length;
  const pct = (k, d = n) => (d ? Math.round((1000 * k) / d) / 10 : null);
  const pages = [...new Set(rows.map((x) => x.file))].map((f) => rows.find((x) => x.file === f));
  const deviceS = pages.map((p) => p.device_s).filter((v) => typeof v === 'number');
  return {
    pages: pages.length, cards: n, empty_pockets: rows.length - n,
    // what happens to each card, adding up to 100%
    auto_right_pct: pct(c('auto-right')),             // reconhecimento automático certo
    first_right_pct: pct(c('first-right')),           // 1ª sugestão certa (um toque)
    manual_pct: pct(c('alt-right') + c('not-offered')), // correção manual: outra opção oferecida ou busca pelo nome
    alt_right_pct: pct(c('alt-right')),
    not_offered_pct: pct(c('not-offered')),
    card_as_empty: c('card-as-empty'),
    false_positive: c('false-positive'),              // cards and empty pockets
    false_positive_cards: cards.filter((x) => x.v === 'false-positive').length,
    false_positive_empty: rows.filter((x) => !x.truth && x.v === 'false-positive').length,
    identified_pct: pct(c('auto-right') + c('first-right')),
    within_reach_pct: pct(c('auto-right') + c('first-right') + c('alt-right')),
    needs_person_pct: pct(cards.filter((x) => x.status !== 'ok').length),
    empty_right: c('empty-right'), empty_asked: c('empty-asked'),
    // time: on the phone (read off the check screen and typed in the annotation) and, apart, on the measuring computer
    device_s_pages: deviceS.length, device_s_median: median(deviceS), device_s_max: max(deviceS),
    desktop_ms_median: median(pages.map((p) => p.desktop_ms)), desktop_ms_max: max(pages.map((p) => p.desktop_ms)),
  };
}

// The set the protocol asks for (docs/scanner-2.0-avaliacao.md, section 1), checked item by item before any target is
// judged. A field that was not registered never counts as met: an old truth.json without it is "incompleto".
export const PROTOCOL = {
  pages: 30, devices: 3, pagesPerDevice: 10,
  perDevice: { good: 4, glare: 2, dark: 2, tilt: 2 },   // luz boa e de frente / reflexo / luz fraca / inclinada
  foilCards: 15, foilPages: 6, emptyPockets: 6, emptyPages: 6, samePairPages: 3, reprintPages: 3, binders: 2,
};
const has = (p, k) => p[k] !== undefined && p[k] !== null && p[k] !== '';
export function coverage(truth, rows) {
  const pages = truth.pages || [], P = PROTOCOL, checks = [];
  const add = (req, ok, detail) => checks.push({ req, ok: !!ok, detail });
  const unregistered = (k, label) => { const n = pages.filter((p) => !has(p, k)).length; if (n) add(`${label} registrado em todas as páginas`, false, `${n} página(s) sem ${label}`); return n === 0; };
  add('Fotos reais', truth.real === true, truth.real ? 'reais' : 'fotos sintéticas: nenhuma meta vale como resultado do produto');
  add(`${P.pages} páginas`, pages.length >= P.pages, `${pages.length} de ${P.pages} páginas`);
  // devices: how many, iPhone and Android, one entry-level or older than 3 years, 10 pages each
  const devs = {}; for (const p of pages) if (has(p, 'device')) (devs[p.device] ||= []).push(p);
  unregistered('device', 'o aparelho');
  add(`${P.devices} aparelhos`, Object.keys(devs).length >= P.devices, `${Object.keys(devs).length} de ${P.devices} aparelhos`);
  if (unregistered('os', 'o sistema (iOS/Android)')) {
    const osOf = (d) => [...new Set(devs[d].map((p) => p.os))];
    const mixed = Object.keys(devs).filter((d) => osOf(d).length > 1);
    add('Sistema coerente por aparelho', !mixed.length, mixed.length ? `sistema diferente entre páginas de: ${mixed.join(', ')}` : 'ok');
    add('Pelo menos 1 iPhone e 1 Android', ['ios', 'android'].every((o) => Object.keys(devs).some((d) => osOf(d).includes(o))),
      `iOS: ${Object.keys(devs).filter((d) => osOf(d).includes('ios')).join(', ') || 'nenhum'}; Android: ${Object.keys(devs).filter((d) => osOf(d).includes('android')).join(', ') || 'nenhum'}`);
  }
  if (unregistered('device_older', 'a marcação de aparelho de entrada/antigo'))
    add('Um aparelho de entrada ou com mais de 3 anos', Object.values(devs).some((l) => l.every((p) => p.device_older === true)), Object.keys(devs).filter((d) => devs[d].every((p) => p.device_older === true)).join(', ') || 'nenhum aparelho marcado como de entrada ou com mais de 3 anos');
  for (const [d, l] of Object.entries(devs)) add(`${d}: ${P.pagesPerDevice} páginas`, l.length >= P.pagesPerDevice, `${d}: ${l.length} de ${P.pagesPerDevice} páginas`);
  // conditions, per device
  if (unregistered('light', 'a luz') & unregistered('tilt', 'a inclinação')) {
    for (const [d, l] of Object.entries(devs)) {
      const n = { good: l.filter((p) => p.light === 'boa' && p.tilt === false).length, glare: l.filter((p) => p.light === 'reflexo').length,
        dark: l.filter((p) => p.light === 'fraca').length, tilt: l.filter((p) => p.tilt === true).length };
      const lack = Object.entries(P.perDevice).filter(([k, v]) => n[k] < v);
      add(`${d}: condições (4 boa e de frente, 2 reflexo, 2 luz fraca, 2 inclinadas)`, !lack.length,
        `${d}: ${n.good} boa e de frente, ${n.glare} reflexo, ${n.dark} luz fraca, ${n.tilt} inclinadas`);
    }
  }
  // foils: per pocket
  if (unregistered('foil', 'o foil por posição')) {
    const fc = pages.reduce((a, p) => a + p.foil.filter((f, i) => f && p.cards[i]).length, 0), fp = pages.filter((p) => p.foil.some((f, i) => f && p.cards[i])).length;
    add(`${P.foilCards} cartas foil em ${P.foilPages}+ páginas`, fc >= P.foilCards && fp >= P.foilPages, `${fc} de ${P.foilCards} cartas foil, em ${fp} de ${P.foilPages} páginas`);
  }
  // empty pockets, spread over different pages
  const ep = pages.filter((p) => (p.cards || []).some((c) => !c)).length, en = pages.reduce((a, p) => a + (p.cards || []).filter((c) => !c).length, 0);
  add(`${P.emptyPockets} bolsos vazios em ${P.emptyPages} páginas diferentes`, en >= P.emptyPockets && ep >= P.emptyPages, `${en} de ${P.emptyPockets} bolsos vazios, em ${ep} de ${P.emptyPages} páginas diferentes`);
  // repetitions: the same card twice on a page; reprints (registered by the person)
  const twice = pages.filter((p) => { const c = (p.cards || []).filter(Boolean); return new Set(c).size < c.length; }).length;
  add(`${P.samePairPages} páginas com a mesma carta em duas posições`, twice >= P.samePairPages, `${twice} de ${P.samePairPages} páginas com a mesma carta em duas posições`);
  if (unregistered('reprint', 'a marcação de reimpressão'))
    add(`${P.reprintPages} páginas com reimpressão`, pages.filter((p) => p.reprint === true).length >= P.reprintPages, `${pages.filter((p) => p.reprint === true).length} de ${P.reprintPages} páginas com reimpressão`);
  // binders
  if (unregistered('binder', 'o fichário'))
    add(`${P.binders} modelos de fichário`, new Set(pages.map((p) => p.binder.toLowerCase())).size >= P.binders, `${new Set(pages.map((p) => p.binder.toLowerCase())).size} de ${P.binders} modelos de fichário`);
  // the time on the phone, for every page
  const timed = pages.filter((p) => typeof p.device_s === 'number' && isFinite(p.device_s)).length;
  add('Tempo no aparelho em todas as páginas', timed === pages.length && pages.length > 0, `${timed} de ${pages.length} páginas com o tempo no aparelho`);
  const missing = checks.filter((c) => !c.ok).map((c) => c.detail);
  const byDev = Object.fromEntries(Object.entries(devs).map(([d, l]) => [d, l.length]));
  return { complete: checks.length > 0 && missing.length === 0, missing, checks, pages_by_device: byDev };
}

// Targets (section 5). Judged only on a complete, real set; otherwise "não avaliável".
export function targets(all, byDevice, cov) {
  const judge = (ok) => (cov.complete ? (ok == null ? 'sem dados' : ok ? 'atingida' : 'não atingida') : 'não avaliável');
  const devs = Object.values(byDevice);
  const slowest = max(devs.map((d) => d.device_s_max));
  return {
    'Identificação ≥ 95% no total': judge(all.identified_pct == null ? null : all.identified_pct >= 95),
    'Identificação ≥ 90% em cada aparelho': judge(devs.length ? devs.every((d) => d.identified_pct >= 90) : null),
    'Falso positivo = 0': judge(all.false_positive === 0),
    'Carta tomada por vazio = 0': judge(all.card_as_empty === 0),
    'Ao alcance ≥ 98%': judge(all.within_reach_pct == null ? null : all.within_reach_pct >= 98),
    'Tempo ≤ 4 s no aparelho mais lento': judge(slowest == null ? null : slowest <= 4),
  };
}

export function report(truth, rows, extra = {}) {
  for (const x of rows) x.v = verdict(x);
  const devices = [...new Set(rows.map((x) => x.device).filter(Boolean))], conds = [...new Set(rows.map((x) => x.cond))];
  const all = summarise(rows), by_device = Object.fromEntries(devices.map((d) => [d, summarise(rows.filter((x) => x.device === d))]));
  const cov = coverage(truth, rows);
  return { photos: truth.real ? 'real' : 'synthetic', ...extra, coverage: cov, targets: targets(all, by_device, cov), all, by_device,
    by_cond: Object.fromEntries(conds.map((k) => [k, summarise(rows.filter((x) => x.cond === k))])),
    pockets: rows.map(({ file, device, cond, i, truth: t, status, id, v }) => ({ file, device, cond, i, truth: t, status, id, v })) };
}

// The summary that goes into a PR or an issue: numbers as measured, targets only when the set allows judging them.
export function markdown(r) {
  const row = (k, s) => `| ${k} | ${s.pages} | ${s.cards} | ${s.auto_right_pct ?? '–'}% | ${s.first_right_pct ?? '–'}% | ${s.manual_pct ?? '–'}% | ${s.card_as_empty} | ${s.false_positive} | ${s.device_s_median ?? '–'} / ${s.device_s_max ?? '–'} s |`;
  return [
    `**Fotos:** ${r.photos === 'real' ? 'reais' : 'sintéticas (não valem como resultado do produto)'} · **Conjunto:** ${r.coverage.complete ? 'completo' : 'incompleto: ' + r.coverage.missing.join('; ')}`,
    '',
    '| | Páginas | Cartas | Automática certa | 1ª sugestão certa | Correção manual | Carta tomada por vazio | Falso positivo | Tempo no aparelho (mediana / máx.) |',
    '|---|---|---|---|---|---|---|---|---|',
    row('**Total**', r.all), ...Object.entries(r.by_device).map(([d, s]) => row(d, s)),
    '',
    '| Meta | Situação |', '|---|---|', ...Object.entries(r.targets).map(([k, v]) => `| ${k} | ${v} |`),
  ].join('\n');
}

// ---- §6: video frame × photo, from the site's A3 records (?medicao=a3), scored with the same verdict and summary ----
// recs: the a3-*.json records; truth: truth.json from the annotation tool (one page per record, file <name>-foto.jpg
// or <name>-video.jpg). The same annotated set serves §4 (bench) and §6 (this): one annotation, one set of categories.
const p90 = (a) => { const s = a.filter((v) => v != null).sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.ceil(s.length * 0.9) - 1)] : null; };
// exact McNemar (two-sided binomial on the discordant pockets)
export function mcnemar(k, n) { if (!n) return 1; let p = 0; const lo = Math.min(k, n - k); for (let i = 0; i <= lo; i++) { let c = 1; for (let j = 0; j < i; j++) c = (c * (n - j)) / (j + 1); p += c / 2 ** n; } return Math.min(1, Math.round(2 * p * 1000) / 1000); }
export const uaInfo = (ua = '') => { const ios = /iPhone|iPad|iPod/.test(ua), m = ua.match(/OS (\d+)[_.](\d+)/); return { os: ios ? 'ios' : /Android/.test(ua) ? 'android' : '', ios_version: ios && m ? +`${m[1]}.${m[2]}` : null, chrome: /Chrome\//.test(ua) && !/Edg\//.test(ua) }; };

export function a3Compare(recs, truth) {
  const T = new Map((truth.pages || []).map((p) => [p.file.replace(/-(foto|video)\.jpg$/i, ''), p]));
  const missing = recs.filter((r) => !T.has(r.name)).map((r) => r.name), pages = recs.filter((r) => T.has(r.name));
  // what the site measured completes the annotation (the time the person saw, the system); typed values win
  const tpages = pages.map((r) => { const t = T.get(r.name), u = uaInfo(r.ua);
    return { ...t, os: t.os || u.os, device_s: typeof t.device_s === 'number' ? t.device_s : r.seen?.ready != null ? Math.round(r.seen.ready / 100) / 10 : null, ios_version: u.ios_version, chrome: u.chrome }; });
  const captureMs = (r, k) => (k === 'video' ? r.times.frameMs : r.times.frameMs + (r.times.stillMs || 0) + (r.times.alignMs || 0));
  const rows = [];
  pages.forEach((r, n) => { const t = tpages[n];
    for (const k of ['video', 'foto', 'site']) { const mk = k === 'site' ? r.used : k, m = r.modes[mk]; if (!m?.pockets) continue;
      m.pockets.forEach((p, i) => { const x = { file: r.name, page: r.name, mode: k, device: t.device || '?', cond: t.cond || '', i, truth: t.cards[i] || null, ...p,
        ms: captureMs(r, mk) + (m.engineMs || 0) + (m.ocrMs || 0), device_s: t.device_s }; x.v = verdict(x); rows.push(x); }); } });
  const sum = (list) => { const perPage = [...new Map(list.map((x) => [x.page, x.ms])).values()]; return { ...summarise(list), total_ms_median: median(perPage), total_ms_p90: p90(perPage) }; };
  const by = (mode) => rows.filter((x) => x.mode === mode), devices = [...new Set(rows.map((x) => x.device))];
  const ident = (v) => v === 'auto-right' || v === 'first-right', key = (x) => `${x.page}#${x.i}`;
  const V = new Map(by('video').map((x) => [key(x), x])), paired = by('foto').filter((x) => x.truth && V.has(key(x)));
  const pair = { pockets: paired.length, foto_only: paired.filter((x) => ident(x.v) && !ident(V.get(key(x)).v)).length, video_only: paired.filter((x) => !ident(x.v) && ident(V.get(key(x)).v)).length,
    fp_foto_only: by('foto').filter((x) => x.v === 'false-positive' && V.get(key(x))?.v !== 'false-positive').length,
    fp_video_only: by('video').filter((x) => x.v === 'false-positive' && by('foto').find((y) => key(y) === key(x))?.v !== 'false-positive').length };
  pair.mcnemar_p = mcnemar(pair.foto_only, pair.foto_only + pair.video_only);
  const capture = { pages: pages.length, photo_taken: pages.filter((r) => r.modes.foto).length, aligned: pages.filter((r) => r.aligned).length,
    used_photo: pages.filter((r) => r.used === 'foto').length, fallback: pages.filter((r) => r.used !== 'foto').length,
    fallback_reasons: pages.filter((r) => r.used !== 'foto').reduce((o, r) => ({ ...o, [r.fallback || '?']: (o[r.fallback || '?'] || 0) + 1 }), {}),
    align_median: median(pages.map((r) => r.align)), align_min: pages.reduce((m, r) => (r.align != null && (m == null || r.align < m) ? r.align : m), null),
    video_px: [...new Set(pages.map((r) => r.modes.video?.px))], photo_px: [...new Set(pages.map((r) => r.modes.foto?.px).filter(Boolean))],
    still_ms_median: median(pages.map((r) => r.times.stillMs)), align_ms_median: median(pages.map((r) => r.times.alignMs)) };
  const all = { video: sum(by('video')), foto: sum(by('foto')), site: sum(by('site')) };
  const by_device = Object.fromEntries(devices.map((d) => [d, Object.fromEntries(['video', 'foto', 'site'].map((k) => [k, sum(by(k).filter((x) => x.device === d))]))]));
  // §1 coverage for the same pages, plus what §6.1 adds: a real iPhone on iOS ≥ 18.4 and a real Android with Chrome
  const cov = coverage({ ...truth, pages: tpages }, rows.filter((x) => x.mode === 'site'));
  const ios184 = tpages.some((p) => p.os === 'ios' && p.ios_version >= 18.4), androidChrome = tpages.some((p) => p.os === 'android' && p.chrome);
  cov.checks.push({ req: 'iPhone com iOS ≥ 18.4', ok: ios184, detail: ios184 ? 'ok' : 'nenhuma página de iPhone com iOS ≥ 18.4' }, { req: 'Android com Chrome', ok: androidChrome, detail: androidChrome ? 'ok' : 'nenhuma página de Android com Chrome' });
  if (!ios184) cov.missing.push('nenhuma página de iPhone com iOS ≥ 18.4'); if (!androidChrome) cov.missing.push('nenhuma página de Android com Chrome');
  if (missing.length) { cov.missing.push(`${missing.length} registro(s) sem gabarito`); cov.checks.push({ req: 'Gabarito de todos os registros', ok: false, detail: `${missing.length} sem gabarito` }); }
  cov.complete = cov.missing.length === 0;
  // §6.4, judged only on a complete, real set; "interação" is checked by tests and by use on the phone, not here
  const judge = (ok) => (cov.complete ? (ok ? 'atingido' : 'não atingido') : 'não avaliável');
  const criteria = {
    'Site não pior que Vídeo em nenhum aparelho': judge(Object.values(by_device).every((d) => (d.site.identified_pct ?? 0) >= (d.video.identified_pct ?? 0) && d.site.false_positive <= d.video.false_positive)),
    'Fallback confiável (toda página sem foto ou sem alinhamento lida pelo vídeo)': judge(pages.filter((r) => r.used !== 'foto').every((r) => r.modes.video?.pockets?.length === 9)),
    'Foto > Vídeo em identificação, McNemar p < 0,05': judge(pair.foto_only > pair.video_only && pair.mcnemar_p < 0.05),
    'Falsos positivos da foto ≤ vídeo': judge(all.foto.false_positive <= all.video.false_positive),
    'Nenhuma perda de interação': 'verificar nos testes e no uso no aparelho',
  };
  return { a3: 'video-vs-foto', created: new Date().toISOString(), photos: truth.real ? 'real' : 'synthetic', missing_truth: missing, coverage: cov, criteria, capture, pair, all, by_device,
    verdicts: rows.map(({ page, mode, i, truth: t, status, id, v }) => ({ page, mode, i, truth: t, status, id, v })) };
}

export function a3Markdown(r) {
  const c = r.capture, line = (label, f) => `| ${label} | ${['video', 'foto', 'site'].map((k) => f(r.all[k]) ?? '–').join(' | ')} |`;
  return [
    `## A3 — vídeo × foto (${c.pages} páginas${r.missing_truth.length ? `, ${r.missing_truth.length} sem gabarito` : ''})`, '',
    `**Fotos:** ${r.photos === 'real' ? 'reais' : 'sintéticas (não valem como resultado do produto)'} · **Conjunto:** ${r.coverage.complete ? 'completo' : 'incompleto: ' + r.coverage.missing.join('; ')}`, '',
    `Captura: foto tirada em ${c.photo_taken}/${c.pages}, alinhada em ${c.aligned}, usada em ${c.used_photo}; fallback ${c.fallback}${c.fallback ? ' (' + Object.entries(c.fallback_reasons).map(([k, n]) => `${k}: ${n}`).join(', ') + ')' : ''}.`,
    `Resolução: vídeo ${c.video_px.join(', ')}; foto ${c.photo_px.join(', ') || '–'}. Alinhamento: mediana ${c.align_median ?? '–'}, mínimo ${c.align_min ?? '–'}.`, '',
    '| Por posição | Vídeo | Foto | Site (o que foi usado) |', '|---|---|---|---|',
    line('Identificação (%)', (s) => s.identified_pct), line('Automática certa (%)', (s) => s.auto_right_pct), line('1ª sugestão certa (%)', (s) => s.first_right_pct),
    line('Correção manual (%)', (s) => s.manual_pct), line('Ao alcance (%)', (s) => s.within_reach_pct), line('**Falsos positivos**', (s) => s.false_positive),
    line('Carta tomada por vazio', (s) => s.card_as_empty), line('Tempo total, mediana (ms)', (s) => s.total_ms_median), line('Tempo total, p90 (ms)', (s) => s.total_ms_p90), '',
    `Pareado (${r.pair.pockets} posições com carta): só a foto acertou ${r.pair.foto_only}, só o vídeo ${r.pair.video_only} (McNemar exato p = ${r.pair.mcnemar_p}); falso positivo só na foto ${r.pair.fp_foto_only}, só no vídeo ${r.pair.fp_video_only}.`, '',
    '| Critério (§6.4) | Situação |', '|---|---|', ...Object.entries(r.criteria).map(([k, v]) => `| ${k} | ${v} |`), '',
    'Tempo total = captura (vídeo: quadro; foto: quadro + takePhoto + alinhamento) + motor + leitura dos números. Medido pelo site no aparelho.',
  ].join('\n');
}
