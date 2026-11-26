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
