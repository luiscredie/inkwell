/* Card picker for the showcase (Meu Inkwell editor): search the whole catalogue or only my cards, filter by set,
   ink, rarity and finish, see a card larger, pick the exact printing and finish. Card images keep their real
   proportions (never cropped). Injected into a page by tools/build_site_pages.py at the PICKER_JS marker.

   const picker = window.INKWELL_CARD_PICKER({ dialog, cards, sets, lang, loadCollection, signedIn });
   picker.open({ current: {id, foil} | null, taken: [{id, foil}], from: element, onUse: ({id, foil}) => {} });
   cards: [{id, name, set, num, rarity, ink, img, k}]  (k: normalised search text)
   sets:  [{code, name_en, name_pt}]  loadCollection: async () => {card_id: {n, f}} | null (null = could not load)
*/
window.INKWELL_CARD_PICKER = (opts) => {
  "use strict";
  const { dialog: d, lang = "pt" } = opts;
  const PT = {
    "Choose a card": "Escolher carta", "Search by name or character": "Buscar por nome ou personagem", "Full catalogue": "Todo o catálogo",
    "Only cards I own": "Só cartas que possuo", "Sign in to filter by your collection.": "Entre para filtrar pela sua coleção.", "Use this card": "Usar esta carta",
    "No cards found. Try clearing the filters.": "Nenhuma carta encontrada. Tente limpar os filtros.", "This version is already in your showcase.": "Esta versão já está na sua vitrine.",
    "Loading your collection…": "Carregando sua coleção…", "Your collection is empty. Explore the catalogue or add your cards.": "Sua coleção ainda está vazia. Explore o catálogo ou adicione suas cartas.",
    "We could not load your collection. You can still explore the full catalogue.": "Não conseguimos consultar sua coleção. Você ainda pode explorar todo o catálogo.",
    "Close": "Fechar", "Set": "Set", "Ink": "Tinta", "Rarity": "Raridade", "Finish": "Acabamento", "All": "Todos", "Normal": "Normal", "Foil": "Foil",
    "Show more": "Mostrar mais", "{n} cards": "{n} cartas", "1 card": "1 carta", "Cards from the newest set, to start with. Search for any other.": "Cartas do set mais recente, para começar. Busque qualquer outra.",
    "See larger": "Ver maior", "Back to the results": "Voltar aos resultados", "You own this version": "Você tem esta versão", "You own another finish of this card": "Você tem esta carta em outro acabamento",
  };
  const RAR = { C: ["Common", "Comum"], U: ["Uncommon", "Incomum"], R: ["Rare", "Rara"], SR: ["Super Rare", "Super-rara"], L: ["Legendary", "Lendária"], E: ["Enchanted", "Encantada"],
    EP: ["Epic", "Épica"], I: ["Iconic", "Icônica"], P: ["Promo", "Promo"], N: ["Special", "Especial"] };
  const INKS = ["Amber", "Amethyst", "Emerald", "Ruby", "Sapphire", "Steel"];
  const INK_PT = { Amber: "Âmbar", Amethyst: "Ametista", Emerald: "Esmeralda", Ruby: "Rubi", Sapphire: "Safira", Steel: "Aço" };
  const Tx = (en, v) => { const s = lang === "pt" && PT[en] ? PT[en] : en; return v ? s.replace(/\{(\w+)\}/g, (m, k) => (k in v ? String(v[k]) : m)) : s; };
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const norm = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const split = (name) => { const i = name.search(/\s[-–]\s/); return i > 0 ? [name.slice(0, i), name.slice(i + 3)] : [name, ""]; };
  const setRank = (code, i) => { const m = /^LOR(\d+)$/.exec(code) || []; const q = /^Q(\d+)$/.exec(code) || []; return m[1] ? +m[1] : q[1] ? 100 + +q[1] : 200 + i; };
  const SETS = (opts.sets || []).map((x, i) => ({ ...x, rank: setRank(x.code, i) })).sort((a, b) => a.rank - b.rank);
  const RANK = new Map(SETS.map((s) => [s.code, s.rank]));
  const setName = (code) => { const s = SETS.find((x) => x.code === code); return s ? (lang === "pt" && s.name_pt) || s.name_en || code : code; };
  const CARDS = (opts.cards || []).filter((c) => c.rarity !== "T" && c.type !== "T");
  const BY = new Map(CARDS.map((c) => [c.id, c]));
  const NEWEST = SETS.filter((s) => /^LOR\d+$/.test(s.code) && CARDS.some((c) => c.set === s.code)).at(-1)?.code;
  const numOf = (c) => parseInt(String(c.num).replace(/\D+/g, ""), 10) || 0;
  const finishes = (c) => (["E", "EP", "I"].includes(c?.rarity) ? ["f"] : ["n", "f"]);   // Enchanted, Epic, Iconic: foil only
  const inksOf = (c) => String(c?.ink || "").split(/[,/]\s*/).map((x) => x.trim()).filter(Boolean);
  const inkName = (i) => (lang === "pt" ? INK_PT[i] || i : i);
  const rarName = (r) => (RAR[r] ? RAR[r][lang === "pt" ? 1 : 0] : r || "");
  const imgUrl = (c) => (c?.img ? `../lorcana-card-images/${encodeURI(c.img).replace(/'/g, "%27")}` : "");
  const cardFace = (c, foil) => {
    const [a, b] = split(c?.name || ""), label = `${a}${b ? " · " + b : ""} — ${setName(c?.set)} nº ${c?.num || ""}`;
    return `<span class="iw-card">${c?.img ? `<img src="${imgUrl(c)}" alt="${esc(label)}" width="250" height="350" loading="lazy" decoding="async" onerror="this.nextElementSibling.setAttribute('aria-hidden','false');this.remove()">` : ""}
      <span class="iw-fallback" aria-hidden="${c?.img ? "true" : "false"}">${esc(a)}${b ? `<br><small>${esc(b)}</small>` : ""}<br><small>${esc(setName(c?.set))} · nº ${esc(c?.num || "")}</small></span>
      ${foil ? `<span class="iw-foil">${Tx("Foil")}</span>` : ""}</span>`;
  };
  const PAGE = 24;
  let pk = null, coll = { state: "off", data: {} };   // off | loading | ready | empty | error

  async function loadColl() {
    if (!opts.signedIn?.() || coll.state !== "off") return;
    coll = { state: "loading", data: {} }; if (pk) draw();
    try {
      const data = await opts.loadCollection?.();
      if (data == null) throw new Error("no collection");
      const any = Object.values(data).some((e) => (+e?.n || 0) + (+e?.f || 0) > 0);
      coll = { state: any ? "ready" : "empty", data };
    } catch { coll = { state: "error", data: {} }; }
    if (pk) draw();
  }
  const owns = (id, fin) => { const e = coll.data[id]; return coll.state === "ready" && e ? (+e[fin] || 0) > 0 : false; };
  const finOf = (c) => pk.fin_of[c.id] || (pk.fin && finishes(c).includes(pk.fin) ? pk.fin : finishes(c)[0]);
  const dupe = (c, fin) => pk.taken.some((f) => f.id === c.id && !!f.foil === (fin === "f"));
  function results() {
    const words = norm(pk.q).split(" ").filter(Boolean), start = !words.length && !pk.set && !pk.ink && !pk.rar && !pk.fin && pk.scope === "all";
    let rows = CARDS.filter((c) => (!words.length || words.every((w) => c.k.includes(w))) && (!pk.set || c.set === pk.set) && (!pk.ink || inksOf(c).includes(pk.ink))
      && (!pk.rar || c.rarity === pk.rar) && (!pk.fin || finishes(c).includes(pk.fin))
      && (pk.scope !== "owned" || (+coll.data[c.id]?.n || 0) + (+coll.data[c.id]?.f || 0) > 0));
    if (start && NEWEST) rows = rows.filter((c) => c.set === NEWEST);
    rows.sort((a, b) => (RANK.get(b.set) ?? 0) - (RANK.get(a.set) ?? 0) || numOf(a) - numOf(b));
    return { rows, start };
  }
  function finishSeg(c, where) {
    const fs = finishes(c); if (fs.length < 2) return `<span class="meta">${Tx("Foil")}</span>`;
    return `<div class="seg" role="group" aria-label="${Tx("Finish")}">${fs.map((f) => `<button type="button" data-fin="${esc(c.id)}:${f}:${where}" aria-pressed="${finOf(c) === f}">${Tx(f === "f" ? "Foil" : "Normal")}</button>`).join("")}</div>`;
  }
  function ownLine(c) {
    if (coll.state !== "ready") return "";
    const f = finOf(c), other = f === "f" ? "n" : "f";
    return owns(c.id, f) ? `<span class="owned">${Tx("You own this version")}</span>` : owns(c.id, other) ? `<span class="meta">${Tx("You own another finish of this card")}</span>` : "";
  }
  function draw() {
    if (!pk) return;
    const keep = document.activeElement?.id, caret = document.activeElement?.selectionStart;
    const head = `<div class="iw-dhead"><h2 class="iw-h3" id="pkT" style="margin:0">${Tx("Choose a card")}</h2><button type="button" class="iw-button small" id="pkClose">${Tx("Close")}</button></div>`;
    if (pk.zoom) {
      const c = BY.get(pk.zoom), f = finOf(c), [a, b] = split(c.name), dup = dupe(c, f);
      d.innerHTML = `${head}<div class="iw-dbody"><button type="button" class="iw-link" id="pkBack" style="justify-self:start">← ${Tx("Back to the results")}</button>
        <div class="iw-zoom" data-testid="zoom">${cardFace(c, f === "f")}<div style="display:grid;gap:var(--sp-3)"><div><h3 class="iw-h2" style="margin:0">${esc(a)}</h3>${b ? `<p class="iw-lead" style="margin:0">${esc(b)}</p>` : ""}</div>
          <p class="meta" style="margin:0">${esc([setName(c.set), "nº " + c.num, rarName(c.rarity), inksOf(c).map(inkName).join(" / ")].filter(Boolean).join(" · "))}</p>
          ${finishSeg(c, "z")}${ownLine(c)}
          ${dup ? `<p class="iw-msg" role="alert">${Tx("This version is already in your showcase.")}</p>` : ""}
          <button type="button" class="iw-button iw-button-primary" data-use="${esc(c.id)}" ${dup ? "disabled" : ""}>${Tx("Use this card")}</button></div></div></div>`;
    } else {
      const { rows, start } = results(), show = rows.slice(0, pk.shown);
      const opt = (v, l, cur) => `<option value="${esc(v)}" ${cur === v ? "selected" : ""}>${esc(l)}</option>`;
      const usedRar = [...new Set(CARDS.map((c) => c.rarity))].filter((r) => RAR[r]);
      const signed = !!opts.signedIn?.();
      d.innerHTML = `${head}<div class="iw-dbody">
        <label for="pkQ" class="lbl" style="font-weight:700">${Tx("Search by name or character")}</label>
        <input class="iw-input" id="pkQ" type="search" autocomplete="off" value="${esc(pk.q)}" placeholder="${esc(Tx("Search by name or character"))}">
        <div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center"><div class="seg" role="group" aria-label="${Tx("Full catalogue")}">
          <button type="button" data-scope="all" aria-pressed="${pk.scope === "all"}">${Tx("Full catalogue")}</button>
          <button type="button" data-scope="owned" aria-pressed="${pk.scope === "owned"}" ${signed ? "" : 'disabled aria-describedby="ownHint"'} ${coll.state === "loading" ? 'aria-busy="true"' : ""}>${Tx("Only cards I own")}</button></div>
          ${signed ? "" : `<span class="small" id="ownHint" style="color:var(--iw-muted)">${Tx("Sign in to filter by your collection.")}</span>`}</div>
        ${pk.scope === "owned" && coll.state === "loading" ? `<p class="iw-msg" role="status" data-testid="coll-loading">${Tx("Loading your collection…")}</p>` : ""}
        ${pk.scope === "owned" && coll.state === "empty" ? `<p class="iw-msg" role="status" data-testid="coll-empty">${Tx("Your collection is empty. Explore the catalogue or add your cards.")}</p>` : ""}
        ${pk.scope === "owned" && coll.state === "error" ? `<p class="iw-msg err" role="alert" data-testid="coll-error">${Tx("We could not load your collection. You can still explore the full catalogue.")}</p>` : ""}
        <div class="iw-filters">
          <label>${Tx("Set")}<select id="pkSet">${opt("", Tx("All"), pk.set)}${SETS.filter((s) => CARDS.some((c) => c.set === s.code)).map((s) => opt(s.code, setName(s.code), pk.set)).join("")}</select></label>
          <label>${Tx("Ink")}<select id="pkInk">${opt("", Tx("All"), pk.ink)}${INKS.map((i) => opt(i, inkName(i), pk.ink)).join("")}</select></label>
          <label>${Tx("Rarity")}<select id="pkRar">${opt("", Tx("All"), pk.rar)}${usedRar.map((r) => opt(r, rarName(r), pk.rar)).join("")}</select></label>
          <label>${Tx("Finish")}<select id="pkFin">${opt("", Tx("All"), pk.fin)}${opt("n", Tx("Normal"), pk.fin)}${opt("f", Tx("Foil"), pk.fin)}</select></label>
        </div>
        <p class="small" style="margin:0;color:var(--iw-muted)" data-testid="pk-count">${start ? esc(Tx("Cards from the newest set, to start with. Search for any other.")) + " · " : ""}${esc(rows.length === 1 ? Tx("1 card") : Tx("{n} cards", { n: rows.length.toLocaleString(lang === "pt" ? "pt-BR" : "en") }))}</p>
        ${rows.length ? `<div class="iw-results" data-testid="results">${show.map((c) => { const f = finOf(c), dup = dupe(c, f), [a, b] = split(c.name);
            return `<div class="iw-result" data-card="${esc(c.id)}"><button type="button" class="iw-zbtn" data-zoom="${esc(c.id)}" aria-label="${esc(Tx("See larger") + " · " + a + (b ? " · " + b : ""))}">${cardFace(c, f === "f")}</button>
              <strong style="overflow-wrap:anywhere">${esc(a)}</strong>${b ? `<span class="small">${esc(b)}</span>` : ""}<span class="meta">${esc(setName(c.set))} · nº ${esc(c.num)} · ${esc(rarName(c.rarity))}</span>
              ${finishSeg(c, "r")}${ownLine(c)}
              <button type="button" class="iw-button ${dup ? "" : "iw-button-primary"} small" data-use="${esc(c.id)}" ${dup ? "disabled" : ""}>${Tx(dup ? "This version is already in your showcase." : "Use this card")}</button></div>`; }).join("")}</div>
          ${rows.length > pk.shown ? `<button type="button" class="iw-button" id="pkMore" style="justify-self:center">${Tx("Show more")}</button>` : ""}`
          : `<p class="iw-msg" role="status" data-testid="no-results">${Tx("No cards found. Try clearing the filters.")}</p>`}
      </div>`;
    }
    wire();
    const el = keep && d.querySelector("#" + CSS.escape(keep));
    if (el) { el.focus(); try { if (caret != null && el.setSelectionRange) el.setSelectionRange(caret, caret); } catch { /* not a text field */ } }
  }
  function wire() {
    const $q = (s) => d.querySelector(s);
    $q("#pkClose").onclick = () => d.close();
    $q("#pkQ")?.addEventListener("input", (e) => { pk.q = e.target.value; pk.shown = PAGE; draw(); });
    for (const [id, k] of [["pkSet", "set"], ["pkInk", "ink"], ["pkRar", "rar"], ["pkFin", "fin"]]) $q("#" + id)?.addEventListener("change", (e) => { pk[k] = e.target.value; pk.shown = PAGE; draw(); });
    d.querySelectorAll("[data-scope]").forEach((b) => b.addEventListener("click", () => { if (b.disabled) return; pk.scope = b.dataset.scope; pk.shown = PAGE; draw(); }));
    $q("#pkMore")?.addEventListener("click", () => { const n = pk.shown; pk.shown += PAGE; draw(); d.querySelectorAll(".iw-result [data-zoom]")[n]?.focus(); });
    d.querySelectorAll("[data-zoom]").forEach((b) => b.addEventListener("click", () => { pk.zoom = b.dataset.zoom; draw(); $q("#pkBack")?.focus(); }));
    $q("#pkBack")?.addEventListener("click", () => { const id = pk.zoom; pk.zoom = null; draw(); d.querySelector(`[data-zoom="${CSS.escape(id)}"]`)?.focus(); });
    d.querySelectorAll("[data-fin]").forEach((b) => b.addEventListener("click", () => { const [id, f] = b.dataset.fin.split(":"); pk.fin_of[id] = f; draw(); d.querySelector(`[data-fin="${CSS.escape(b.dataset.fin)}"]`)?.focus(); }));
    d.querySelectorAll("[data-use]").forEach((b) => b.addEventListener("click", () => {
      const c = BY.get(b.dataset.use), f = finOf(c);
      if (dupe(c, f)) return;
      const use = pk.onUse; d.close(); use?.({ id: c.id, foil: f === "f" });
    }));
  }
  d.addEventListener("close", () => { const f = pk?.from; pk = null; d.innerHTML = ""; if (f && document.contains(f)) f.focus(); });
  return {
    open({ current = null, taken = [], from = null, onUse }) {
      pk = { q: "", set: "", ink: "", rar: "", fin: "", scope: "all", shown: PAGE, zoom: null, fin_of: {}, taken, from, onUse };
      if (current && BY.get(current.id)) pk.fin_of[current.id] = current.foil ? "f" : "n";
      draw(); d.showModal(); d.querySelector("#pkQ")?.focus();
      loadColl();
    },
    resetCollection() { coll = { state: "off", data: {} }; },
    cardFace, finishes, owns: (id, foil) => { const e = coll.data[id]; return !!e && (+e[foil ? "f" : "n"] || 0) > 0; },
  };
};
