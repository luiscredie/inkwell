/* Inkwell — "Importar coleção": reads a collection exported by another app without asking which one.
 *
 *   INKWELL_COLL_IMPORT.parse(text, fileName, cards, sets) -> { format, rows: [{ id, n, f, line }], rejects: [{ line, raw, reason }] }
 *     cards  [{ id, name, set, num }]    (the page's card index)
 *     sets   [{ code, name_en, name_pt }]
 *
 * What it understands:
 *   - Inkwell's own export (CSV card_id,name,set,normal,foil, or JSON { collection: { id: { n, f } } })
 *   - Dreamborn CSV (Set Number, Card Number, Variant, Count, Name…)
 *   - any spreadsheet whose header names the columns, in English or Portuguese: quantity (count, qty, quantidade…),
 *     set (number, code or name), card number, name, finish (foil, variant, printing, acabamento, extras…).
 *     TCGplayer's export fits this. Comma, semicolon (Excel in Portuguese) or tab.
 *   - a plain list, one card per line: "4 Elsa - Spirit of Winter", "4x Elsa…", "Elsa… x4", optionally "(foil)".
 * Each line is matched by id, then set + number, then name (set kept if given). Lines it can't place come back
 * in rejects with the reason, so the page can show them. Nothing here touches the network. */
(function (root) {
  "use strict";
  const norm = (s) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[’']/g, "").replace(/[^a-z0-9]+/g, " ").trim();
  const COLS = {
    id: ["card_id", "card id", "id", "inkwell id"],
    qty: ["count", "qty", "quantity", "quantidade", "qtd", "qtde", "quant", "copies", "copias", "amount", "total quantity", "owned", "have", "tenho"],
    normal: ["normal", "n", "regular", "nonfoil", "non foil", "non-foil"],
    foilQty: ["foil", "f", "foils", "foil qty", "foil count", "foil quantity"],
    set: ["set number", "set", "set code", "set name", "edition", "expansion", "edicao", "colecao", "expansao", "set no", "set #"],
    num: ["card number", "number", "collector number", "card no", "no", "#", "numero", "num", "n do card", "nr"],
    name: ["name", "card name", "card", "nome", "carta", "simple name", "product name", "product"],
    finish: ["variant", "finish", "printing", "foil type", "acabamento", "extras", "extra", "tipo", "versao", "condition foil"],
  };
  const isFoil = (v) => /foil|brilh|holo|^(yes|sim|true|1|x)$/i.test(String(v ?? "").trim()) && !/non.?foil|^normal$/i.test(String(v ?? "").trim());

  function splitLine(line, sep) {
    const out = []; let cur = "", q = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (q) { if (ch === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += ch; }
      else if (ch === '"') q = true;
      else if (ch === sep) { out.push(cur); cur = ""; }
      else cur += ch;
    }
    out.push(cur);
    return out.map((x) => x.trim());
  }
  const sepOf = (head) => { const c = { ",": 0, ";": 0, "\t": 0 }; for (const ch of head) if (ch in c) c[ch]++; return Object.entries(c).sort((a, b) => b[1] - a[1])[0][1] ? Object.entries(c).sort((a, b) => b[1] - a[1])[0][0] : null; };

  function index(cards, sets) {
    const byId = new Map(), bySetNum = new Map(), byName = new Map(), setOf = new Map();
    for (const c of cards) {
      byId.set(c.id.toLowerCase(), c);
      bySetNum.set(`${c.set}|${String(c.num).toLowerCase()}`, c);
      const k = norm(c.name); (byName.get(k) || byName.set(k, []).get(k)).push(c);
      const base = norm(String(c.name).replace(/\s*\([^)]*\)\s*$/, ""));   // "Elsa - Spirit of Winter (Enchanted)" also answers to the plain name
      if (base !== k) (byName.get(base) || byName.set(base, []).get(base)).push(c);
    }
    for (const s of sets || []) { setOf.set(norm(s.code), s.code); if (s.name_en) setOf.set(norm(s.name_en), s.code); if (s.name_pt) setOf.set(norm(s.name_pt), s.code); }
    return { byId, bySetNum, byName, setOf };
  }
  // "1", "01", "TFC"? no; "LOR1", "The First Chapter", "P1", "C1"… -> a set code of the catalogue (or null)
  function setCode(v, ix) {
    const s = String(v ?? "").trim(); if (!s) return null;
    if (/^\d{1,2}$/.test(s)) return `LOR${+s}`;
    const k = norm(s);
    if (ix.setOf.has(k)) return ix.setOf.get(k);
    const m = s.match(/^lor\s*(\d{1,2})$/i); if (m) return `LOR${+m[1]}`;
    return s.toUpperCase();   // promo tags (P1, C1, CC1, D23…) are tried as they are
  }
  function find(ix, { id, set, num, name }) {
    if (id) { const c = ix.byId.get(String(id).trim().toLowerCase()); if (c) return c; }
    const n = String(num ?? "").trim().replace(/\s*\/\s*\d+\s*$/, "").replace(/^#/, "").replace(/^0+(?=\d)/, "").toLowerCase();
    const code = setCode(set, ix);
    if (code && n) {
      const c = ix.bySetNum.get(`${code}|${n}`); if (c) return c;
      if (/^(P|C|CC|DIS)\d*$/i.test(code)) { const p = ix.bySetNum.get(`DLPC1|${n}-${code.toLowerCase()}`); if (p) return p; }   // Dreamborn promos: set "P2", number "1" -> DLPC1 "1-P2"
    }
    if (name) {
      const list = ix.byName.get(norm(name)) || ix.byName.get(norm(String(name).replace(/\s*\([^)]*\)\s*$/, "")));
      if (list?.length) return (code && list.find((c) => c.set === code)) || list.find((c) => /^LOR\d+$/.test(c.set) && !/\(/.test(c.name)) || list[0];
    }
    return null;
  }
  const int = (v) => { const n = parseInt(String(v ?? "").replace(/[^\d-]/g, ""), 10); return Number.isFinite(n) && n > 0 ? Math.min(n, 999) : 0; };

  function parse(text, fileName, cards, sets) {
    const ix = index(cards || [], sets);
    const rows = [], rejects = [];
    const add = (c, n, f, line) => { if (n || f) rows.push({ id: c.id, n, f, line }); };
    const src = String(text ?? "").replace(/^﻿/, "");
    // JSON: Inkwell's export ({collection:{id:{n,f}}}, or the data export's inkwell[].data.collection)
    if (/\.json$/i.test(fileName || "") || /^\s*[{[]/.test(src)) {
      let j; try { j = JSON.parse(src); } catch { return { format: "json", rows, rejects: [{ line: 0, raw: fileName || "", reason: "bad_json" }] }; }
      const coll = j?.collection || j?.inkwell?.[0]?.data?.collection || (Array.isArray(j) ? null : j);
      if (Array.isArray(j)) {   // [{card_id|id|name, qty|count, foil}]
        j.forEach((x, i) => { const c = find(ix, { id: x.card_id || x.id, set: x.set || x.set_code, num: x.number || x.card_number, name: x.name });
          if (!c) { rejects.push({ line: i + 1, raw: String(x.name || x.card_id || x.id || "").slice(0, 60), reason: "no_match" }); return; }
          const q = int(x.qty ?? x.count ?? x.quantity ?? 1); add(c, isFoil(x.foil ?? x.finish ?? x.variant) ? 0 : q, isFoil(x.foil ?? x.finish ?? x.variant) ? q : 0, i + 1); });
        return { format: "json", rows, rejects };
      }
      for (const [id, e] of Object.entries(coll || {})) {
        const c = ix.byId.get(id.toLowerCase());
        if (!c) { rejects.push({ line: 0, raw: id.slice(0, 60), reason: "unknown_id" }); continue; }
        add(c, int(e?.n), int(e?.f), 0);
      }
      return { format: "inkwell-json", rows, rejects };
    }
    const lines = src.split(/\r?\n/).map((l) => l.replace(/\s+$/, "")).filter((l) => l.trim());
    if (!lines.length) return { format: "empty", rows, rejects };
    const sep = sepOf(lines[0]);
    const head = sep ? splitLine(lines[0], sep).map((h) => norm(h)) : [];
    const col = (names) => { for (const nm of names) { const i = head.indexOf(norm(nm)); if (i >= 0) return i; } return -1; };
    const iId = col(COLS.id), iQty = col(COLS.qty), iN = col(COLS.normal), iF = col(COLS.foilQty), iSet = col(COLS.set), iNum = col(COLS.num), iName = col(COLS.name), iFin = col(COLS.finish);
    const tabular = sep && (iId >= 0 || iName >= 0 || (iSet >= 0 && iNum >= 0));
    if (tabular) {
      const format = iId >= 0 && iN >= 0 ? "inkwell-csv" : head.includes("set number") && head.includes("card number") ? "dreamborn" : head.includes("simple name") || head.includes("product id") ? "tcgplayer" : "table";
      for (let i = 1; i < lines.length; i++) {
        const p = splitLine(lines[i], sep); if (p.every((x) => !x)) continue;
        const c = find(ix, { id: iId >= 0 ? p[iId] : null, set: iSet >= 0 ? p[iSet] : null, num: iNum >= 0 ? p[iNum] : null, name: iName >= 0 ? p[iName] : null });
        if (!c) { rejects.push({ line: i + 1, raw: [iSet >= 0 ? p[iSet] : "", iNum >= 0 ? p[iNum] : "", iName >= 0 ? p[iName] : (iId >= 0 ? p[iId] : "")].filter(Boolean).join(" · ").slice(0, 80) || lines[i].slice(0, 80), reason: "no_match" }); continue; }
        if (iN >= 0 || (iF >= 0 && iQty < 0 && !isFoil(p[iF]))) { add(c, int(iN >= 0 ? p[iN] : 0), int(iF >= 0 ? p[iF] : 0), i + 1); continue; }   // separate normal/foil counts
        const q = iQty >= 0 ? int(p[iQty]) : 1;
        if (!q) { rejects.push({ line: i + 1, raw: lines[i].slice(0, 80), reason: "no_qty" }); continue; }
        const foil = (iFin >= 0 && isFoil(p[iFin])) || (iF >= 0 && isFoil(p[iF]));
        add(c, foil ? 0 : q, foil ? q : 0, i + 1);
      }
      return { format, rows, rejects };
    }
    // a plain list: "4 Name", "4x Name", "Name x4", "Name" (1)
    lines.forEach((l, i) => {
      if (/^\s*(\/\/|#)/.test(l) || /^\s*(deck|sideboard|main|total)\b/i.test(l)) return;   // comments and section titles
      let s = l.trim(), q = 1, foil = /\((?:cold )?foil\)|\bfoil\b|\*f\*/i.test(s);
      s = s.replace(/\((?:cold )?foil\)|\*f\*/ig, "").replace(/\bfoil\b/ig, "").trim();
      let m = s.match(/^(\d{1,3})\s*x?\s+(.+)$/i); if (m) { q = +m[1]; s = m[2]; } else if ((m = s.match(/^(.+?)\s+x\s*(\d{1,3})$/i))) { q = +m[2]; s = m[1]; }
      let set = null, num = null;
      const sn = s.match(/\s*[([]?\s*(?:set\s*)?([a-z]{0,3}\d{1,2})\s*[-#/ ]\s*#?(\d{1,3}[a-z]?)\s*[)\]]?\s*$/i);   // "… (1-123)", "… [LOR1 #123]"
      if (sn) { set = sn[1]; num = sn[2]; s = s.slice(0, sn.index).trim(); }
      const c = find(ix, { name: s, set, num });
      if (!c) { rejects.push({ line: i + 1, raw: l.slice(0, 80), reason: "no_match" }); return; }
      add(c, foil ? 0 : q, foil ? q : 0, i + 1);
    });
    return { format: "list", rows, rejects };
  }
  // several lines for the same card -> one total per card
  function total(rows) {
    const m = new Map();
    for (const r of rows) { const e = m.get(r.id) || { id: r.id, n: 0, f: 0 }; e.n += r.n; e.f += r.f; m.set(r.id, e); }
    return [...m.values()];
  }
  const api = { parse, total, norm };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.INKWELL_COLL_IMPORT = api;
})(typeof window !== "undefined" ? window : globalThis);
