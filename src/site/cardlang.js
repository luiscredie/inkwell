/* Inkwell — idioma das cartas na coleção (supabase/card_langs.sql). Pure functions, no network.
 *
 *   A card in the collection: { n, f, l? }  n/f = every copy (normal / foil); l = { ja: { n: 1, f: 1 }, en: { n: 1 } }
 *   says the printing language of some of them; the rest have no language recorded ("sem idioma").
 *
 *   INKWELL_CARD_LANG.split(entry)              -> { n, f, l, known: {n, f}, unknown: {n, f} }
 *   INKWELL_CARD_LANG.apply(entry, k, q, lang)  -> the entry after adding (q > 0) or removing (q < 0) copies of one
 *                                                  finish, the same rule as the server; throws { code: "lang_required" |
 *                                                  "lang_short" } when the server would refuse
 *   INKWELL_CARD_LANG.removeChoice(entry, k)    -> null when a copy can be removed without asking, else the languages
 *                                                  to choose from [{ lang, count }]
 *   INKWELL_CARD_LANG.progress(collection)      -> { copies, known, unknown, pct }
 *   INKWELL_CARD_LANG.blocks(text)              -> [{ lang, text, from }]  a pasted text cut at language headings
 *   INKWELL_CARD_LANG.plan(text, collection, cards, sets, parse) -> what marking old copies with that text would do:
 *        { items: [{ card_id, lang, qty, foil }], marked, problems: [{ raw, reason, lang }], conflicts: [...], blocks }
 *   Copied into Coleção by tools/build_site_pages.py at the CARDLANG_JS marker. */
(function (root) {
  "use strict";
  const LANGS = ["en", "fr", "de", "it", "ja", "zh"];
  const NAMES = { en: ["Inglês", "English"], fr: ["Francês", "French"], de: ["Alemão", "German"], it: ["Italiano", "Italian"], ja: ["Japonês", "Japanese"], zh: ["Chinês simplificado", "Simplified Chinese"] };
  const norm = (s) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  // what a heading line may say for each language (Portuguese, English, the code, and the usual shorthands)
  const HEADS = { en: ["ingles", "english", "en", "eng", "ing"], fr: ["frances", "french", "francais", "fr", "fra"], de: ["alemao", "german", "deutsch", "de", "ger", "ale"],
    it: ["italiano", "italian", "it", "ita"], ja: ["japones", "japanese", "ja", "jp", "jap", "jpn"], zh: ["chines", "chines simplificado", "chinese", "simplified chinese", "zh", "cn", "chn"] };
  const HEAD_OF = new Map(Object.entries(HEADS).flatMap(([l, ws]) => ws.map((w) => [w, l])));
  const ok = (l) => LANGS.includes(l);
  const int = (v) => (Number.isFinite(+v) && +v > 0 ? Math.floor(+v) : 0);

  function clean(l) {
    const out = {};
    if (!l || typeof l !== "object") return out;
    for (const lg of LANGS) {
      const x = l[lg]; if (!x || typeof x !== "object") continue;
      const e = {}; if (int(x.n)) e.n = int(x.n); if (int(x.f)) e.f = int(x.f);
      if (e.n || e.f) out[lg] = e;
    }
    return out;
  }
  function split(entry) {
    const n = int(entry?.n), f = int(entry?.f), l = clean(entry?.l);
    const known = { n: 0, f: 0 };
    for (const x of Object.values(l)) { known.n += x.n || 0; known.f += x.f || 0; }
    // a split larger than the total (never written by the server) is read as far as the total goes
    return { n, f, l, known: { n: Math.min(n, known.n), f: Math.min(f, known.f) }, unknown: { n: Math.max(0, n - known.n), f: Math.max(0, f - known.f) } };
  }
  const withL = (e, l) => { const o = { ...e }; delete o.l; const c = clean(l); if (Object.keys(c).length) o.l = c; return o; };
  const fail = (code) => Object.assign(new Error(code), { code });

  function apply(entry, k, q, lang) {
    const e = { n: 0, f: 0, ...(entry || {}) }, s = split(e), l = JSON.parse(JSON.stringify(s.l));
    if (lang != null && !ok(lang)) throw fail("bad_lang");
    let total = s[k];
    if (q > 0) {
      total += q;
      if (lang) l[lang] = { ...(l[lang] || {}), [k]: ((l[lang] || {})[k] || 0) + q };
    } else if (q < 0) {
      const need = -q;
      if (lang) {
        const have = (l[lang] || {})[k] || 0;
        if (have < need) throw fail("lang_short");
        l[lang] = { ...l[lang], [k]: have - need };
      } else if (need > s.unknown[k]) {
        if (total <= need) { for (const lg of Object.keys(l)) l[lg] = { ...l[lg], [k]: 0 }; }
        else {
          const rest = need - s.unknown[k], langs = Object.keys(l).filter((lg) => (l[lg][k] || 0) > 0);
          if (langs.length === 1 && l[langs[0]][k] >= rest) l[langs[0]] = { ...l[langs[0]], [k]: l[langs[0]][k] - rest };
          else throw fail("lang_required");
        }
      }
      total = Math.max(0, total - need);
    }
    return withL({ ...e, [k]: total }, l);
  }
  // removing one copy of a finish: can it go without asking which language?
  function removeChoice(entry, k) {
    const s = split(entry);
    if (s[k] <= 1 || s.unknown[k] > 0) return null;
    const langs = Object.keys(s.l).filter((lg) => (s.l[lg][k] || 0) > 0);
    return langs.length > 1 ? langs.map((lang) => ({ lang, count: s.l[lang][k] })) : null;
  }
  function progress(collection) {
    let copies = 0, known = 0;
    for (const e of Object.values(collection || {})) { const s = split(e); copies += s.n + s.f; known += s.known.n + s.known.f; }
    return { copies, known, unknown: copies - known, pct: copies ? Math.floor((100 * known) / copies) : 100 };
  }
  // "EN 2 · IT 1 · 1 sem idioma" (foil marked), the default language first
  function summary(entry, ui = "pt", first = "en") {
    const s = split(entry), order = [first, ...LANGS.filter((x) => x !== first)], out = [];
    for (const lg of order) { const x = s.l[lg]; if (!x) continue; const parts = [x.n ? `${x.n}` : "", x.f ? `${x.f} foil` : ""].filter(Boolean); out.push(`${lg.toUpperCase()} ${parts.join(" + ")}`); }
    const u = s.unknown.n + s.unknown.f;
    if (u && out.length) out.push(ui === "pt" ? `${u} sem idioma` : `${u} with no language`);
    return out.join(" · ");
  }

  // ---------- a pasted list per language ----------
  function headOf(line) {
    const t = norm(String(line).replace(/[:：\-–—=]+\s*$/, ""));
    return t && HEAD_OF.get(t) || null;
  }
  function blocks(text) {
    const out = []; let cur = null;
    String(text || "").split(/\r?\n/).forEach((raw, i) => {
      const h = headOf(raw);
      if (h) { cur = { lang: h, lines: [], from: i + 1 }; out.push(cur); return; }
      if (!raw.trim()) return;
      if (!cur) { cur = { lang: null, lines: [], from: i + 1 }; out.push(cur); }
      cur.lines.push(raw);
    });
    return out.filter((b) => b.lines.length).map((b) => ({ lang: b.lang, text: b.lines.join("\n"), from: b.from }));
  }
  // cards: [{ id, name, set, num }]; parse: INKWELL_COLL_IMPORT.parse
  function plan(text, collection, cards, sets, parse) {
    const col = collection || {}, problems = [], want = [];   // want: { name, id, explicit, lang, k, qty, raw }
    const nkey = (n) => norm(String(n || "").replace(/\s*\([^)]*\)\s*$/, ""));
    const byName = new Map(); for (const c of cards || []) { const key = nkey(c.name); (byName.get(key) || byName.set(key, []).get(key)).push(c); }
    const BY = new Map((cards || []).map((c) => [c.id, c]));
    const bs = blocks(text);
    for (const b of bs) {
      if (!b.lang) { for (const raw of b.text.split("\n")) problems.push({ raw, reason: "no_lang", lang: null }); continue; }
      const lines = b.text.split("\n"), res = parse(b.text, "", cards, sets);
      for (const r of res.rejects || []) problems.push({ raw: r.raw, reason: r.reason === "no_qty" ? "no_qty" : "no_match", lang: b.lang });
      for (const r of res.rows || []) {
        const raw = lines[(r.line || 1) - 1] || "", explicit = /\b[a-z]{0,3}\d{1,2}\s*[-#/ ]\s*#?\d{1,3}[a-z]?\s*[)\]]?\s*$/i.test(raw.replace(/\((?:cold )?foil\)|\bfoil\b|\*f\*/ig, "").trim());
        for (const k of ["n", "f"]) if (r[k]) want.push({ name: nkey(BY.get(r.id)?.name), id: r.id, explicit, lang: b.lang, k, qty: r[k], raw });
      }
    }
    // copies without a language left, per printing and finish, as the list uses them up
    const left = new Map();
    const unk = (id, k) => { const key = `${id}|${k}`; if (!left.has(key)) left.set(key, split(col[id]).unknown[k]); return left.get(key); };
    const take = (id, k, q) => left.set(`${id}|${k}`, unk(id, k) - q);
    // a name may match several printings: use the ones in the collection, the one read first, then the most copies
    const asks = new Map();   // "name|k" -> { name, k, have, asks: [{ lang, qty, raw }], printings }
    for (const w of want) {
      const prints = w.explicit ? [w.id] : [w.id, ...(byName.get(w.name) || []).map((c) => c.id).filter((x) => x !== w.id && col[x])];
      const key = `${w.explicit ? w.id : w.name}|${w.k}`;
      const g = asks.get(key) || asks.set(key, { name: w.name, id: w.id, k: w.k, prints, asks: [] }).get(key);
      g.asks.push({ lang: w.lang, qty: w.qty, raw: w.raw });
    }
    const items = [], conflicts = [];
    for (const g of asks.values()) {
      const have = g.prints.reduce((t, id) => t + unk(id, g.k), 0), need = g.asks.reduce((t, a) => t + a.qty, 0);
      const owned = g.prints.some((id) => split(col[id])[g.k] > 0);
      if (!owned) { for (const a of g.asks) problems.push({ raw: a.raw, reason: "not_owned", lang: a.lang }); continue; }
      if (need > have) { conflicts.push({ card_id: g.id, k: g.k, have, asks: g.asks.map((a) => ({ lang: a.lang, qty: a.qty, raw: a.raw })), multi: new Set(g.asks.map((a) => a.lang)).size > 1 }); continue; }
      for (const a of g.asks) {
        let q = a.qty;
        for (const id of g.prints.slice().sort((x, y) => (x === g.id ? -1 : y === g.id ? 1 : unk(y, g.k) - unk(x, g.k)))) {
          const t = Math.min(q, unk(id, g.k)); if (!t) continue;
          take(id, g.k, t); q -= t;
          const same = items.find((x) => x.card_id === id && x.lang === a.lang && x.foil === (g.k === "f"));
          if (same) same.qty += t; else items.push({ card_id: id, lang: a.lang, qty: t, foil: g.k === "f" });
          if (!q) break;
        }
      }
    }
    const marked = items.reduce((t, x) => t + x.qty, 0);
    return { items, marked, problems, conflicts, blocks: bs.map((b) => ({ lang: b.lang, from: b.from })) };
  }

  const api = { LANGS, NAMES, ok, clean, split, apply, removeChoice, progress, summary, blocks, plan, headOf,
    name: (lg, ui = "pt") => (NAMES[lg] || [lg, lg])[ui === "pt" ? 0 : 1] };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.INKWELL_CARD_LANG = api;
})(typeof window !== "undefined" ? window : globalThis);
