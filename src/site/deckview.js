// A deck shown as cards (Decks > Visão geral do deck, and a shared deck on /perfil/?u=<handle>#deck-<id>).
// One place for the rules both pages use: the numbers, the order of the cards, the foil mark, the list text and
// the grid. Each page passes its own helpers (texts, names, images) and calls INKWELL_DECKVIEW(...) once.
// Card objects: { id, name, cost, type, song, inkable, rarity, set, num, img, ink }.
window.INKWELL_DECKVIEW = function ({ esc, Tx, split, inksOf, imgUrl, setNo, nameKey, LOC }) {
  // Enchanted, Epic, Iconic and promos exist only in foil. A deck does not record the finish of each copy,
  // so these are the only cards marked foil (the same rule as Coleção, Preços and the Fada Madrinha).
  const ALWAYS_FOIL = new Set(["I", "EP", "E", "P"]);
  const keyOf = (c) => c.key || nameKey(c.name);
  // known: [{ c, q }] — cards found in the catalog, with copies
  function summary(known) {
    const s = { total: 0, distinct: 0, nonInk: 0, char: 0, action: 0, song: 0, item: 0, location: 0, avg: 0, curve: Array(7).fill(0) };
    const names = new Set(); let cost = 0;
    for (const { c, q } of known) {
      s.total += q; names.add(keyOf(c)); cost += (+c.cost || 0) * q;
      if (!c.inkable) s.nonInk += q;
      if (c.type === "Character") s.char += q;
      else if (c.type === "Location") s.location += q;
      else if (c.type === "Action" || c.type === "Song" || c.song) { s.action += q; if (c.song) s.song += q; }   // a song is an action: counted once, under actions
      else s.item += q;
      s.curve[Math.min(7, Math.max(1, +c.cost || 0)) - 1] += q;
    }
    s.distinct = names.size; s.avg = s.total ? cost / s.total : 0;
    return s;
  }
  const printNo = (c) => parseInt(String(c.num || "").replace(/\D+/g, ""), 10) || 0;
  const printLabel = (c) => `${c.set} #${c.num}`;
  // cost, then name, then printing (set, number)
  const sorted = (known) => known.slice().sort((a, b) => a.c.cost - b.c.cost || a.c.name.localeCompare(b.c.name)
    || setNo(a.c.set) - setNo(b.c.set) || String(a.c.set).localeCompare(String(b.c.set)) || printNo(a.c) - printNo(b.c) || a.c.id.localeCompare(b.c.id));
  // "4 Stitch - Rock Star (LOR1-1)": the usual list plus which printing; Importar (Decks) reads it back
  const listText = (known) => sorted(known).map((e) => `${e.q} ${e.c.name} (${e.c.id})`).join("\n");
  const isFoil = (c) => ALWAYS_FOIL.has(c.rarity);
  function tile(e) {
    const c = e.c, foil = isFoil(c), [a, b] = split(c.name);
    // the name is always there under the art: a card whose image is missing or does not load still says what it is
    return `<span class="thumb ov-card" data-card="${esc(c.id)}" data-ink="${(inksOf(c)[0] || "steel").toLowerCase()}" role="img" aria-label="${esc(`${e.q}× ${c.name} · ${printLabel(c)}${foil ? " · " + Tx("foil") : ""}`)}"><span class="ov-noart"><b>${esc(c.cost)}</b><span>${esc(a)}</span>${b ? `<small>${esc(b)}</small>` : ""}</span>${c.img
      ? `<img src="${imgUrl(c)}" alt="" loading="lazy" decoding="async" onerror="this.remove()">` : ""}<b class="ov-q">${e.q}×</b>${foil ? `<i class="ov-foil" title="${esc(Tx("This printing exists only in foil"))}">${Tx("Foil")}</i>` : ""}</span>`;
  }
  // the numbers (most important first) and the cost curve
  function head(s) {
    const stat = (v, l, k) => `<div class="ov-stat" data-testid="ov-${k}"><b>${v}</b><span>${esc(l)}</span></div>`, top = Math.max(1, ...s.curve);
    return `<div class="ov-head">
      <div class="ov-stats">${stat(s.total, Tx("Cards"), "total")}${stat(s.char, Tx("Characters"), "char")}${stat(s.action, s.song ? Tx("Actions ({n} songs)", { n: s.song }) : Tx("Actions"), "action")}${stat(s.nonInk, Tx("Non-inkable"), "noink")}
        ${stat(s.item, Tx("Items"), "item")}${stat(s.location, Tx("Locations"), "location")}${stat(s.distinct, Tx("Distinct"), "distinct")}</div>
      <figure class="ov-curve" data-testid="ov-curve"><figcaption class="small muted">${esc(Tx("Cost curve · average {a}", { a: s.avg.toLocaleString(LOC, { maximumFractionDigits: 1 }) }))}</figcaption>
        <div class="bars" style="--n:7">${s.curve.map((v) => `<div><b>${v}</b><i style="--v:${Math.round((v / top) * 100)}%"></i></div>`).join("")}</div>
        <div class="bars-x" style="--n:7">${[1, 2, 3, 4, 5, 6, "7+"].map((x) => `<span>${x}</span>`).join("")}</div></figure>
    </div>`;
  }
  const foilNote = (known) => (known.some((e) => isFoil(e.c)) ? `<p class="small faint ov-note" data-testid="ov-foil-note">${esc(Tx("Foil: only on printings that exist only in foil. A deck does not record the finish of each copy."))}</p>` : "");
  // the styles of the grid, once per page (they travel with the page that uses them)
  function style() {
    if (document.getElementById("iwDeckView")) return;
    const st = document.createElement("style"); st.id = "iwDeckView"; st.textContent = `
.ov-head { display: grid; grid-template-columns: minmax(0, 1.4fr) minmax(0, 1fr); gap: var(--sp-4); align-items: end; margin-bottom: var(--sp-4); }
.ov-stats { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: var(--sp-3); }
.ov-stat { display: grid; gap: 2px; min-width: 0; }
.ov-stat b { font: 800 1.35rem/1.1 var(--display); }
.ov-stat span { font-size: var(--fs-small); color: var(--text-2); overflow-wrap: anywhere; }
.ov-curve { margin: 0; display: grid; gap: var(--sp-2); }
.ov-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(112px, 1fr)); gap: var(--sp-3); }
.ov-card { width: 100%; border-radius: 8px; box-shadow: 0 6px 16px rgba(5,3,20,.35); cursor: zoom-in; }
.ov-card .ov-q { position: absolute; z-index: 2; top: 5%; right: 5%; padding: 1px 7px; border-radius: 999px; background: rgba(19,16,42,.9); box-shadow: inset 0 0 0 1.5px rgba(236,192,97,.8); color: #ecc061; font-weight: 800; font-size: var(--fs-small); }
.ov-card .ov-foil { position: absolute; z-index: 2; left: 5%; bottom: 6%; padding: 1px 6px; border-radius: 999px; background: linear-gradient(90deg, #f7d98b, #c9b6ff, #8fe0c0); color: #13102a; font: 800 10px/1.4 var(--font); letter-spacing: .04em; text-transform: uppercase; font-style: normal; }
.ov-noart { position: absolute; inset: 0; z-index: 0; display: grid; align-content: center; justify-items: center; gap: 2px; padding: 12% 8%; text-align: center; background: linear-gradient(160deg, var(--surface-2), var(--ink, var(--line-strong))); font-size: var(--fs-small); font-weight: 700; line-height: 1.2; }
.ov-noart b { font: 800 1.1rem var(--display); }
.ov-noart small { font-weight: 500; color: var(--text-2); }
.ov-note { margin: var(--sp-2) 0 0; }
@media (max-width: 760px) { .ov-head { grid-template-columns: 1fr; gap: var(--sp-3); } }
@media (max-width: 640px) {
  .ov-stats { display: flex; flex-wrap: wrap; gap: 4px var(--sp-3); }
  .ov-stat { display: inline-flex; align-items: baseline; gap: 5px; }
  .ov-stat b { font-size: 1.05rem; }
  .ov-curve .bars { height: 92px; padding-top: 14px; }
  .ov-curve .bars-x { margin-top: 2px; }
}
@media (max-width: 420px) { .ov-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); gap: var(--sp-2); } .ov-card .ov-q { font-size: 11px; padding: 0 5px; } }`;
    document.head.append(st);
  }
  return { ALWAYS_FOIL, isFoil, summary, sorted, listText, printLabel, tile, head, foilNote, style };
};
