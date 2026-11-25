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
  if ((x.group || []).includes(x.truth) || (x.top || []).some((t) => t.id === x.truth)) return 'alt-right';
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

// The set the protocol asks for (section 1), checked before any target is judged.
export const PROTOCOL = { pages: 30, devices: 3, pagesPerDevice: 10, foilCards: 15, emptyPockets: 6 };
export function coverage(truth, rows) {
  const pages = truth.pages || [], devs = {};
  for (const p of pages) devs[p.device || '?'] = (devs[p.device || '?'] || 0) + 1;
  const missing = [];
  if (!truth.real) missing.push('fotos sintéticas: nenhuma meta vale como resultado do produto');
  if (pages.length < PROTOCOL.pages) missing.push(`${pages.length} de ${PROTOCOL.pages} páginas`);
  const named = Object.keys(devs).filter((d) => d !== '?');
  if (named.length < PROTOCOL.devices) missing.push(`${named.length} de ${PROTOCOL.devices} aparelhos`);
  for (const [d, k] of Object.entries(devs)) if (k < PROTOCOL.pagesPerDevice) missing.push(`${d}: ${k} de ${PROTOCOL.pagesPerDevice} páginas`);
  const empties = rows.filter((x) => !x.truth).length;
  if (empties < PROTOCOL.emptyPockets) missing.push(`${empties} de ${PROTOCOL.emptyPockets} bolsos vazios`);
  const foilPages = pages.filter((p) => /foil/.test(p.cond || '')).length;
  if (foilPages < 6) missing.push(`${foilPages} de 6 páginas com foil`);
  const timed = pages.filter((p) => typeof p.device_s === 'number').length;
  if (timed < pages.length) missing.push(`${pages.length - timed} página(s) sem o tempo no aparelho`);
  return { complete: missing.length === 0, missing, pages_by_device: devs };
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
