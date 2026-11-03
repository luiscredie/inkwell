/* Inkwell site shell (design v2, Noite): app bar, phone tab bar, account menu and the one sign-in sheet.
   Markup and classes follow packages/ui/tokens.css (§4 Shell, §11 Sheet); see DESIGN-CHANGES.md.
   Pages set window.INKWELL_SHELL = { page: "feed" | "cards" | "decks" | "coach" | "trades" } and may call:
     window.INKWELL_SIGNIN()            open the sign-in sheet
     window.INKWELL_SHELL_BADGE(n)      set the Trocas count (requests waiting for me)
   Sign-in uses window.INKWELL_CLOUD (cloud.js): one session for the whole site. */
(() => {
  "use strict";
  let lang = "pt";
  try { lang = localStorage.getItem("inkwell-lang") || "pt"; } catch { /* */ }
  const pt = lang === "pt";
  const T = (p, e) => (pt ? p : e);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const page = (window.INKWELL_SHELL || {}).page || "";
  const UI = "../ui/";
  const CLOUD = window.INKWELL_CLOUD;
  const me = CLOUD?.user();
  // ---------- site statistics (supabase/site_stats.sql; the admin Painel) ----------
  // No cookies, no IP: a random code that lives only while this tab is open; signed in or not; phone or computer;
  // the other site's domain. Nothing is sent from "do not track" browsers or by automated browsers.
  const STAT_OFF = navigator.webdriver || navigator.globalPrivacyControl === true || navigator.doNotTrack === "1" || window.doNotTrack === "1";
  let statSid = null;
  try { statSid = sessionStorage.getItem("inkwell-sid"); if (!/^[a-f0-9]{24}$/.test(statSid || "")) { statSid = [...crypto.getRandomValues(new Uint8Array(12))].map((b) => b.toString(16).padStart(2, "0")).join(""); sessionStorage.setItem("inkwell-sid", statSid); } } catch { statSid = null; }
  const statDev = () => (matchMedia("(pointer: coarse)").matches || innerWidth < 700 ? "mobile" : "desktop");
  const statRef = () => { try { const h = document.referrer ? new URL(document.referrer).hostname.toLowerCase() : ""; return h && h !== location.hostname ? h.replace(/^www\./, "").slice(0, 60) : null; } catch { return null; } };
  const statSend = (kind, name) => {
    if (STAT_OFF || !statSid || !CLOUD || !page) return;
    CLOUD.api("rpc/track", { method: "POST", prefer: "return=minimal", anon: true, keepalive: true, body: { p_sid: statSid, p_page: page, p_kind: kind, p_name: name || null, p_ref: kind === "view" ? statRef() : null, p_dev: statDev() } }).catch(() => {});
  };
  // pages call INKWELL_TRACK("scan_open") etc.; each action counts once per page view
  const statDone = new Set();
  window.INKWELL_TRACK = (name) => { if (!/^[a-z_]{1,30}$/.test(name || "") || statDone.has(name)) return; statDone.add(name); statSend("action", name); };
  statSend("view");
  // Every module stays in the top bar (design "The Great Illuminary", 26/10/2026). On phones the bottom bar has
  // the four main places plus "Mais", which lists the rest; nothing is hidden behind the account menu only.
  const NAV = [
    ["feed", "../feed/", T("Início", "Home"), "home"],
    ["cards", "../colecao/", T("Coleção", "Collection"), "cards"],
    ["decks", "../decks/", "Decks", "decks"],
    ["communities", "../comunidades/", T("Comunidades", "Communities"), "users"],
    ["coach", "../coach/", T("Jogos", "Games"), "games"],
    ["events", "../eventos/", T("Eventos", "Events"), "calendar"],
    ["trades", "../trades/", T("Trocas", "Trades"), "trades"],
    ["prices", "../precos/", T("Preços", "Prices"), "coins"],
  ];
  const TABS = ["feed", "cards", "decks", "communities"];
  const MORE = NAV.filter(([k]) => !TABS.includes(k));
  let theme = "dia"; try { theme = localStorage.getItem("inkwell-theme") === "noite" ? "noite" : "dia"; } catch { /* */ }
  const cur = (k) => (k === page ? ' aria-current="page"' : "");

  if (!document.querySelector('link[rel="manifest"]')) {
    document.head.insertAdjacentHTML("beforeend", `<link rel="manifest" href="../inkwell.webmanifest"><meta name="apple-mobile-web-app-capable" content="yes"><meta name="mobile-web-app-capable" content="yes"><meta name="apple-mobile-web-app-title" content="Inkwell">`);
  }
  const bar = document.createElement("header");
  bar.className = "appbar";
  bar.innerHTML = `<div class="appbar-in"><a class="brand" href="../feed/"><img src="../ink/logo-coin.png" alt="" width="32" height="32">Inkwell</a>
    <nav class="sections" aria-label="${T("Seções", "Sections")}">${NAV.map(([k, href, label, ic]) => `<a href="${href}"${cur(k)} data-iw="${k}"><i class="ic i-${ic}"></i>${label}${k === "trades" ? '<span class="count" data-trades-count hidden></span>' : ""}</a>`).join("")}</nav>
    <div class="end">
      <button type="button" class="btn ghost icon" id="iwTheme" aria-pressed="${theme === "noite"}" aria-label="${theme === "noite" ? T("Usar o tema claro", "Use the light theme") : T("Usar o tema escuro", "Use the dark theme")}"><i class="ic ${theme === "noite" ? "i-sun" : "i-moon"}"></i></button>
      <a class="btn ghost counter-btn" href="../counter/" aria-label="${T("Abrir o Contador", "Open the Counter")}"><i class="ic i-counter"></i><span>${T("Contador", "Counter")}</span></a>
      ${me ? `<button type="button" class="btn ghost icon" id="iwFind" aria-label="${T("Buscar pessoas e comunidades", "Search people and communities")}" aria-haspopup="dialog" aria-expanded="false" title="${T("Buscar", "Search")} ( / )"><i class="ic i-search"></i></button>` : ""}
      ${me ? `<button type="button" class="btn ghost icon bell-btn" id="iwBell" aria-label="${T("Notificações", "Notifications")}" aria-haspopup="menu" aria-expanded="false" hidden><i class="ic i-bell"></i><span class="count" id="iwBellN" hidden></span></button>` : ""}
      ${me ? `<button type="button" class="av-btn" id="iwAcct" aria-label="${T("Sua conta", "Your account")}" aria-haspopup="menu" aria-expanded="false"><span class="av" id="iwAv">${esc((me.email || "?")[0].toUpperCase())}</span><span class="count iw-badge" id="iwBadge" hidden></span></button>`
        : `<button type="button" class="btn ghost icon" id="iwLangBtn" aria-label="${T("Aparência e idioma", "Appearance and language")}" aria-haspopup="menu" aria-expanded="false"><i class="ic i-globe"></i></button>
           <button type="button" class="btn small" id="iwSignIn">${T("Entrar", "Sign in")}</button>`}
    </div></div>`;
  document.body.prepend(bar);
  const tabs = document.createElement("nav");
  tabs.className = "tabbar";
  tabs.setAttribute("aria-label", T("Seções", "Sections"));
  const inMore = MORE.some(([k]) => k === page);
  tabs.innerHTML = NAV.filter(([k]) => TABS.includes(k)).map(([k, href, label, ic]) => `<a href="${href}"${cur(k)} data-iw="${k}"><i class="pip"><i class="ic i-${ic}"></i></i>${label}</a>`).join("")
    + `<button type="button" id="iwMore" class="tab-more" aria-haspopup="dialog" aria-expanded="false"${inMore ? ' aria-current="page"' : ""}><i class="pip"><i class="ic i-more"></i></i>${T("Mais", "More")}<span class="count" data-trades-count hidden></span></button>`;
  document.body.append(tabs);
  document.body.classList.add("iw-has-shell");

  // ---------- menus ----------
  const end = bar.querySelector(".end");
  let menu = null, opener = null;
  const closeMenu = () => { if (!menu) return; menu.remove(); menu = null; opener?.setAttribute("aria-expanded", "false"); opener?.focus(); opener = null; };
  function openMenu(btn, html, cls = "") {
    if (menu) { const same = opener === btn; closeMenu(); if (same) return; }
    opener = btn; btn.setAttribute("aria-expanded", "true");
    menu = document.createElement("div");
    menu.className = `menu ${cls}`; menu.setAttribute("role", "menu");
    menu.innerHTML = html;
    end.append(menu);
    menu.querySelector("[role^=menuitem], button")?.focus();
    menu.querySelectorAll("[data-lang-pick]").forEach((b) => b.addEventListener("click", () => {
      if (b.dataset.langPick !== lang) { try { localStorage.setItem("inkwell-lang", b.dataset.langPick); } catch { /* */ } location.reload(); }
    }));
    menu.querySelector("[data-invite]")?.addEventListener("click", (e) => window.INKWELL_INVITE(e.currentTarget));
    menu.querySelector("[data-feedback]")?.addEventListener("click", () => window.INKWELL_FEEDBACK?.());
    menu.querySelector("[data-signout]")?.addEventListener("click", () => {
      try { localStorage.removeItem("inkwell-guest-intent-v1"); } catch { /* */ }   // signing out cancels a pending "save after sign-in"; the draft stays
      CLOUD?.signOut(); location.reload();
    });
  }
  document.addEventListener("click", (e) => { if (menu && !menu.contains(e.target) && !opener?.contains(e.target)) closeMenu(); });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeMenu();
    if (menu && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
      const items = [...menu.querySelectorAll("[role^=menuitem], .seg button")];
      const i = items.indexOf(document.activeElement);
      items[(i + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length]?.focus(); e.preventDefault();
    }
  });
  const langSeg = () => `<div class="menu-label">${T("Idioma", "Language")}</div>
    <div class="seg block" role="group" aria-label="${T("Idioma", "Language")}">${[["pt", "Português"], ["en", "English"]].map(([k, l]) => `<button type="button" data-lang-pick="${k}" aria-pressed="${k === lang}">${l}</button>`).join("")}</div>`;
  let profileName = "", syncAgo = "", isAdmin = false, news = null, myInvite = null;
  // ---------- "Convidar para o Inkwell": your invite link (perfil/?convite=…); whoever signs up through it gets your friend request ----------
  window.INKWELL_INVITE = async (btn) => {
    window.INKWELL_TRACK("invite");
    if (!me || !CLOUD) { window.INKWELL_SIGNIN?.(); return; }
    if (!myInvite) { const p = await CLOUD.api("rpc/my_profile", { method: "POST", body: {} }).catch(() => null); if (p?.invite_code) myInvite = { code: p.invite_code, handle: p.handle, pub: !!p.is_public }; }
    const done = (t) => { if (!btn) return; const old = btn.innerHTML; btn.innerHTML = `<i class="ic i-check"></i>${t}`; setTimeout(() => { btn.innerHTML = old; }, 2500); };
    if (!myInvite?.code) { done(T("Não deu, tente de novo", "Couldn't, try again")); return; }
    const url = new URL(`../perfil/?convite=${encodeURIComponent(myInvite.code)}${myInvite.handle && myInvite.pub ? `&u=${encodeURIComponent(myInvite.handle)}` : ""}`, location.href).href;
    const text = T("Vem para o Inkwell! Coleção, decks, trocas e eventos de Lorcana num lugar só. É grátis. Entrando por este link, a gente já fica amigo:",
      "Join me on Inkwell! Lorcana collection, decks, trades and events in one place. It's free. Sign up through this link and we're friends right away:");
    try { if (navigator.share) { await navigator.share({ title: "Inkwell", text, url }); return; } } catch (e) { if (e?.name === "AbortError") return; }
    try { await navigator.clipboard.writeText(`${text} ${url}`); done(T("Link copiado", "Link copied")); } catch { window.prompt(T("Copie o link do convite:", "Copy the invite link:"), url); }
  };
  // Notices: friend requests, recados waiting for approval, new posts in your communities (supabase/my_account.sql my_home).
  // "New" posts are the ones after you last opened Início (kept per account in this browser).
  const SEEN_KEY = me ? `inkwell-seen-${me.id}` : "";
  const seenAt = () => { try { return Date.parse(localStorage.getItem(SEEN_KEY) || "") || 0; } catch { return 0; } };
  window.INKWELL_MARK_SEEN = () => { try { localStorage.setItem(SEEN_KEY, new Date().toISOString()); } catch { /* */ } if (news) { news.posts = 0; showNews(); } };
  function showNews() {
    const b = $("iwBadge"); if (!b || !news) return;
    const n = news.requests + news.recados + news.posts + (news.wants || 0);
    b.hidden = !n; b.textContent = n > 9 ? "9+" : String(n);
    $("iwAcct")?.setAttribute("aria-label", n ? T(`Sua conta · ${n} novidades`, `Your account · ${n} new`) : T("Sua conta", "Your account"));
  }
  const newsMenu = () => {
    if (!news || !(news.requests + news.recados + news.posts + (news.wants || 0))) return "";
    const item = (href, ic, text, n) => (n ? `<a class="menu-item" role="menuitem" href="${href}"><i class="ic i-${ic}"></i>${text}<span class="trail"><span class="count">${n}</span></span></a>` : "");
    return `<div class="menu-sep"></div><div class="menu-label">${T("Novidades", "New for you")}</div>
      ${item("../feed/#amigos", "user-plus", news.requests === 1 ? T("Pedido de amizade", "Friend request") : T("Pedidos de amizade", "Friend requests"), news.requests)}
      ${item("../perfil/?editar=1#recados", "comment", news.recados === 1 ? T("Recado para aprovar", "Recado to approve") : T("Recados para aprovar", "Recados to approve"), news.recados)}
      ${item("../feed/", "board", T("Mensagens nas comunidades", "Community messages"), news.posts)}
      ${item("../trades/?tab=board", "trades", news.wants === 1 ? T("Carta que você quer no mural", "A card you want on the board") : T("Cartas que você quer no mural", "Cards you want on the board"), news.wants || 0)}`;
  };
  $("iwAcct")?.addEventListener("click", (e) => openMenu(e.currentTarget, `
    <div class="menu-head"><span class="av lg">${esc((profileName || me.email || "?")[0].toUpperCase())}</span><div class="t"><b>${esc(profileName || T("Sua conta", "Your account"))}</b><div class="small">${esc(me.email || "")}</div></div></div>
    ${newsMenu()}
    <div class="menu-sep"></div>
    <button type="button" class="menu-item" role="menuitem" data-invite><i class="ic i-send"></i>${T("Convidar amigos para o Inkwell", "Invite friends to Inkwell")}</button>
    <a class="menu-item" role="menuitem" href="../perfil/?editar=1"><i class="ic i-users"></i>${T("Meu Inkwell", "My Inkwell")}</a>
    <a class="menu-item" role="menuitem" href="../comunidades/"><i class="ic i-board"></i>${T("Comunidades", "Communities")}</a>
    <a class="menu-item" role="menuitem" href="../feed/#amigos"><i class="ic i-user-plus"></i>${T("Amigos e privacidade", "Friends and privacy")}</a>
    <a class="menu-item" role="menuitem" href="../coach/"><i class="ic i-refresh"></i>${T("Jogos do duels.ink", "duels.ink games")}${syncAgo ? `<span class="trail">${esc(syncAgo)}</span>` : ""}</a>
    ${isAdmin ? `<a class="menu-item" role="menuitem" href="../admin/"><i class="ic i-shield"></i>Admin</a>` : ""}
    <button type="button" class="menu-item" role="menuitem" data-feedback><i class="ic i-comment"></i>${T("Enviar feedback", "Send feedback")}</button>
    <a class="menu-item" role="menuitem" href="../privacidade/"><i class="ic i-info"></i>${T("Termos e privacidade", "Terms and privacy")}</a>
    ${langSeg()}
    <div class="menu-sep"></div>
    <button type="button" class="menu-item" role="menuitem" data-signout><i class="ic i-logout"></i>${T("Sair", "Sign out")}</button>`));
  $("iwLangBtn")?.addEventListener("click", (e) => openMenu(e.currentTarget, `<div class="menu-label">${T("Idioma", "Language")}</div>
    ${[["pt", "Português"], ["en", "English"]].map(([k, l]) => `<button type="button" class="menu-item" role="menuitemradio" aria-checked="${k === lang}" data-lang-pick="${k}">${l}${k === lang ? '<i class="ic i-check" style="margin-left:auto;color:var(--text)"></i>' : ""}</button>`).join("")}
`, "sm"));
  function $(id) { return document.getElementById(id); }

  // ---------- light / dark ----------
  $("iwTheme")?.addEventListener("click", () => {
    theme = theme === "noite" ? "dia" : "noite";
    try { localStorage.setItem("inkwell-theme", theme); } catch { /* the choice lasts this page only */ }
    document.documentElement.dataset.theme = theme;
    const b = $("iwTheme");
    b.setAttribute("aria-pressed", String(theme === "noite"));
    b.setAttribute("aria-label", theme === "noite" ? T("Usar o tema claro", "Use the light theme") : T("Usar o tema escuro", "Use the dark theme"));
    b.innerHTML = `<i class="ic ${theme === "noite" ? "i-sun" : "i-moon"}"></i>`;
  });

  // ---------- "Mais" on phones: the modules that are not in the bottom bar ----------
  const more = document.createElement("dialog");
  more.className = "sheet"; more.id = "iwMoreSheet"; more.setAttribute("aria-labelledby", "iwMoreT");
  more.innerHTML = `<div class="grab"></div><div class="sheet-head"><h2 id="iwMoreT">${T("Mais", "More")}</h2>
      <button type="button" class="btn ghost icon" data-close aria-label="${T("Fechar", "Close")}"><i class="ic i-close"></i></button></div>
    <div class="sheet-body"><nav class="more-list" aria-label="${T("Mais seções", "More sections")}">
      ${MORE.map(([k, href, label, ic]) => `<a class="menu-item" href="${href}"${cur(k)} data-iw="${k}"><i class="ic i-${ic}"></i>${label}${k === "trades" ? '<span class="trail"><span class="count" data-trades-count hidden></span></span>' : ""}</a>`).join("")}
      <a class="menu-item" href="../feed/#amigos"><i class="ic i-user-plus"></i>${T("Amigos", "Friends")}</a>
      <a class="menu-item" href="../counter/"><i class="ic i-counter"></i>${T("Contador de lore", "Lore counter")}</a>
      ${me ? `<button type="button" class="menu-item" data-invite><i class="ic i-send"></i>${T("Convidar amigos para o Inkwell", "Invite friends to Inkwell")}</button>` : ""}
      <button type="button" class="menu-item" data-feedback><i class="ic i-comment"></i>${T("Enviar feedback", "Send feedback")}</button>
    </nav></div>`;
  document.body.append(more);
  more.querySelector("[data-invite]")?.addEventListener("click", (e) => window.INKWELL_INVITE(e.currentTarget));
  more.querySelector("[data-feedback]")?.addEventListener("click", () => { more.close(); window.INKWELL_FEEDBACK?.(); });
  more.querySelector("[data-close]").addEventListener("click", () => more.close());
  more.addEventListener("click", (e) => { if (e.target === more) more.close(); });
  more.addEventListener("close", () => { $("iwMore")?.setAttribute("aria-expanded", "false"); $("iwMore")?.focus(); });
  $("iwMore")?.addEventListener("click", () => { more.showModal(); $("iwMore").setAttribute("aria-expanded", "true"); more.querySelector("a")?.focus(); });

  // ---------- sign-in sheet: e-mail → code from the e-mail (or the link in it) ----------
  const sheet = document.createElement("dialog");
  sheet.className = "sheet"; sheet.id = "iwSignSheet"; sheet.setAttribute("aria-labelledby", "iwSiT");
  document.body.append(sheet);

  const IG = window.INKWELL_INSTAGRAM = "https://www.instagram.com/inkwell.brasil/";
  // ---------- rights note, on every page (Inkwell stays free; the rights belong to Disney and Ravensburger) ----------
  {
    const legal = document.createElement("footer");
    legal.className = "iw-legal"; legal.setAttribute("data-testid", "rights");
    legal.innerHTML = T(
      `Disney Lorcana, as imagens das cartas, os símbolos das tintas e as marcas relacionadas pertencem à Disney e à Ravensburger. O Inkwell é um projeto de fã, gratuito e sem vínculo com elas. <a href="../privacidade/">Termos e privacidade</a>`,
      `Disney Lorcana, the card images, the ink symbols and related marks belong to Disney and Ravensburger. Inkwell is a free fan project, not affiliated with them. <a href="../privacidade/">Terms and privacy</a>`);
    // the Instagram profile: a plain link (no embed, so nothing from Meta loads here)
    legal.insertAdjacentHTML("afterbegin", `<p class="iw-social"><button type="button" class="linkbtn" data-feedback data-testid="feedback-open"><i class="ic i-comment" aria-hidden="true"></i> ${T("Achou um erro ou tem uma ideia? Conte pra gente", "Found a bug or have an idea? Tell us")}</button>
      <a href="${IG}" target="_blank" rel="noopener noreferrer" data-testid="instagram"><i class="ic i-camera" aria-hidden="true"></i> ${T("Siga o Inkwell no Instagram", "Follow Inkwell on Instagram")} · @inkwell.brasil</a></p>`);
    legal.querySelector("[data-feedback]").addEventListener("click", () => window.INKWELL_FEEDBACK());
    (document.querySelector("main") || document.body).after(legal);
  }
  // ---------- "Enviar feedback": a bug, an idea, anything (supabase/feedback.sql; read on the admin page) ----------
  {
    const fb = document.createElement("dialog");
    fb.className = "sheet"; fb.id = "iwFeedback"; fb.setAttribute("aria-labelledby", "iwFbT");
    document.body.append(fb);
    let kind = "bug";
    const draw = (done = false, msg = "") => {
      fb.innerHTML = `<div class="grab"></div>
        <div class="sheet-head"><div><h2 id="iwFbT">${T("Enviar feedback", "Send feedback")}</h2><div class="sub">${T("Achou um erro? Tem uma ideia? A gente lê tudo.", "Found a bug? Have an idea? We read everything.")}</div></div>
          <button type="button" class="btn ghost icon" data-close aria-label="${T("Fechar", "Close")}"><i class="ic i-close"></i></button></div>
        <div class="sheet-body">${done ? `<div class="notice ok" data-testid="feedback-done"><i class="ic i-check"></i><div class="t">${T("Recebido. Obrigado por ajudar o Inkwell!", "Got it. Thank you for helping Inkwell!")}</div></div>` : `<form class="form" id="iwFbForm" novalidate>
          <div class="seg" role="radiogroup" aria-label="${T("Tipo", "Kind")}">${[["bug", T("Erro", "Bug")], ["idea", T("Sugestão", "Idea")], ["other", T("Outro", "Other")]].map(([k, l]) => `<button type="button" role="radio" aria-checked="${k === kind}" data-fbk="${k}">${l}</button>`).join("")}</div>
          <label class="field">${kind === "bug" ? T("O que aconteceu? O que você esperava?", "What happened? What did you expect?") : kind === "idea" ? T("Qual é a ideia?", "What's the idea?") : T("Mensagem", "Message")}<textarea id="iwFbText" rows="5" maxlength="2000" required></textarea></label>
          ${me ? "" : `<label class="field">${T("Seu e-mail (opcional, para a gente responder)", "Your e-mail (optional, so we can reply)")}<input id="iwFbMail" type="email" inputmode="email" autocomplete="email" maxlength="120"></label>`}
          <label class="check small"><input type="checkbox" id="iwFbDev" checked> ${T("Incluir a página e o aparelho (ajuda a achar erros)", "Include the page and device (helps find bugs)")}</label>
          <p class="small" id="iwFbMsg" role="alert">${esc(msg)}</p></form>`}</div>
        <div class="sheet-foot">${done ? `<button type="button" class="btn primary" data-close>${T("Fechar", "Close")}</button>` : `<button type="button" class="btn ghost" data-close>${T("Cancelar", "Cancel")}</button><button type="submit" form="iwFbForm" class="btn primary" id="iwFbSend">${T("Enviar", "Send")}</button>`}</div>`;
      fb.querySelectorAll("[data-close]").forEach((b) => b.addEventListener("click", () => fb.close()));
      fb.querySelectorAll("[data-fbk]").forEach((b) => b.addEventListener("click", () => { const t = $("iwFbText").value; kind = b.dataset.fbk; draw(); $("iwFbText").value = t; $("iwFbText").focus(); }));
      $("iwFbForm")?.addEventListener("submit", async (e) => {
        e.preventDefault();
        const text = $("iwFbText").value.trim();
        if (text.length < 3) { $("iwFbMsg").textContent = T("Escreva um pouco mais.", "Write a little more."); return; }
        const dev = $("iwFbDev").checked, b = $("iwFbSend"); b.disabled = true; b.setAttribute("aria-busy", "true");
        try {
          await CLOUD.api("rpc/send_feedback", { method: "POST", anon: !me, prefer: "return=minimal", body: { p_kind: kind, p_body: text, p_page: page || null,
            p_path: dev ? location.pathname.slice(0, 200) : null, p_device: dev ? `${navigator.userAgent} · ${innerWidth}x${innerHeight}`.slice(0, 200) : null, p_email: $("iwFbMail")?.value.trim() || null } });
          window.INKWELL_TRACK("feedback_send"); draw(true);
        } catch (err) { b.disabled = false; b.removeAttribute("aria-busy"); $("iwFbMsg").textContent = /too_many/.test(String(err?.message || err)) ? T("Muitas mensagens agora. Tente de novo mais tarde.", "Too many messages right now. Try again later.") : T("Não foi possível enviar. Tente de novo.", "Couldn't send. Try again."); }
      });
    };
    fb.addEventListener("click", (e) => { if (e.target === fb) fb.close(); });
    window.INKWELL_FEEDBACK = () => { if (!CLOUD) return; kind = "bug"; draw(); document.querySelector("dialog[open]:not(#iwFeedback)")?.close(); fb.showModal(); $("iwFbText")?.focus(); };
  }
  let email = "", trigger = null;
  function stepEmail(msg = "") {
    sheet.innerHTML = `<div class="grab"></div>
      <div class="sheet-head"><div><h2 id="iwSiT">${T("Entrar no Inkwell", "Sign in to Inkwell")}</h2><div class="sub">${T("Sem senha. Mandamos um código.", "No password. We e-mail you a code.")}</div></div>
        <button type="button" class="btn ghost icon" data-close aria-label="${T("Fechar", "Close")}"><i class="ic i-close"></i></button></div>
      <div class="sheet-body">${CLOUD.passkeySupported?.() ? `<div class="stack" style="gap:var(--sp-2);margin-bottom:var(--sp-4)"><button type="button" class="btn block" id="iwSiPk" data-testid="signin-passkey"><i class="ic i-shield"></i>${T("Entrar com passkey (Face ID ou digital)", "Sign in with a passkey (Face ID or fingerprint)")}</button>
        <p class="small faint" style="margin:0;text-align:center">${T("ou receba um código por e-mail", "or get a code by e-mail")}</p></div>` : ""}<form class="form" id="iwSiForm" novalidate>
        <label class="field">${T("E-mail", "E-mail")}<input id="iwSiEmail" type="email" inputmode="email" autocomplete="email" placeholder="voce@exemplo.com" value="${esc(email)}" required></label>
        <p class="small muted">${T("Se for a primeira vez, sua conta é criada agora. Seus jogos ficam salvos e só você decide quem vê.", "If it's your first time, your account is created now. Your games are saved and only you decide who sees them.")}</p>
        <p class="small faint">${T("Ao entrar, você concorda com os", "By signing in you agree to the")} <a href="../privacidade/">${T("Termos e a Privacidade", "Terms and Privacy")}</a>.</p>
        <p class="small" id="iwSiMsg" role="alert">${esc(msg)}</p>
      </form></div>
      <div class="sheet-foot"><button type="button" class="btn ghost" data-close>${T("Cancelar", "Cancel")}</button><button type="submit" form="iwSiForm" class="btn primary" id="iwSiSend">${T("Enviar código", "Send code")}</button></div>`;
    wireClose();
    $("iwSiPk")?.addEventListener("click", async (ev) => {
      const b = ev.currentTarget; b.setAttribute("aria-busy", "true"); b.disabled = true; $("iwSiMsg").textContent = "";
      try { await CLOUD.passkeySignIn(); window.INKWELL_TRACK("signin_passkey"); location.reload(); }
      catch (err) {
        b.removeAttribute("aria-busy"); b.disabled = false;
        $("iwSiMsg").textContent = err?.name === "NotAllowedError" || err?.code === "cancelled"
          ? T("Cancelado ou nenhuma passkey do Inkwell neste aparelho. Entre com o código e crie uma passkey depois.", "Cancelled, or no Inkwell passkey on this device. Sign in with the code and create one afterwards.")
          : T("Não deu para entrar com passkey agora. Use o código por e-mail.", "Couldn't sign in with a passkey right now. Use the e-mail code.");
      }
    });
    $("iwSiForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      email = $("iwSiEmail").value.trim();
      if (!/^\S+@\S+\.\S+$/.test(email)) { $("iwSiMsg").textContent = T("Digite seu e-mail.", "Enter your e-mail."); return; }
      const b = $("iwSiSend"); b.setAttribute("aria-busy", "true"); b.disabled = true;
      try { await CLOUD.requestCode(email); sentAt = Date.now(); window.INKWELL_TRACK("signin_code"); stepCode(); }
      catch { b.removeAttribute("aria-busy"); b.disabled = false; $("iwSiMsg").textContent = T("Não foi possível enviar o e-mail. Confira o endereço e a internet.", "Couldn't send the e-mail. Check the address and your connection."); }
    });
    setTimeout(() => $("iwSiEmail")?.focus(), 30);
  }
  // The e-mail code: Supabase sends 6 to 10 digits (Authentication → Providers → Email → "Email OTP Length").
  // One field takes the whole code, typed or pasted, and never cuts it. Typed digit by digit, nothing is sent until
  // "Entrar"; a whole code arriving at once (the iPhone's suggestion above the keyboard, or a paste) signs in by itself.
  const OTP_MIN = 6, OTP_MAX = 10, RESEND_WAIT = 60;
  let sentAt = 0;
  function stepCode(msg = "") {
    sheet.innerHTML = `<div class="grab"></div>
      <div class="sheet-head"><div><h2 id="iwSiT">${T("Digite o código", "Enter the code")}</h2><div class="sub">${esc(T("Enviado para ", "Sent to ") + email)}</div></div>
        <button type="button" class="btn ghost icon" data-close aria-label="${T("Fechar", "Close")}"><i class="ic i-close"></i></button></div>
      <div class="sheet-body"><form class="form" id="iwSiForm" novalidate>
        <label class="field">${T("Código do e-mail", "Code from the e-mail")}
          <input id="iwSiCode" class="otp-one" inputmode="numeric" autocomplete="one-time-code" spellcheck="false" autocapitalize="off" maxlength="40" aria-describedby="iwSiHint iwSiMsg"></label>
        <span class="hint" id="iwSiHint">${T("Copie ou digite o código inteiro do e-mail mais recente. Confira o spam.", "Copy or type the whole code from the latest e-mail. Check spam too.")}</span>
        <p class="small" id="iwSiMsg" role="alert">${esc(msg)}</p>
        <div class="row between small"><button type="button" class="linkbtn" id="iwSiBack">${T("Trocar e-mail", "Change e-mail")}</button><button type="button" class="linkbtn" id="iwSiAgain"></button></div>
      </form></div>
      <div class="sheet-foot"><button type="button" class="btn ghost" id="iwSiBack2">${T("Voltar", "Back")}</button><button type="submit" form="iwSiForm" class="btn primary" id="iwSiIn" disabled>${T("Entrar", "Sign in")}</button></div>`;
    wireClose();
    const box = $("iwSiCode"), go = $("iwSiIn"), say = (t) => { $("iwSiMsg").textContent = t; };
    const digits = () => box.value.replace(/\D/g, "");
    const sync = () => {
      const n = digits().length;
      go.disabled = n < OTP_MIN || n > OTP_MAX;
      box.classList.remove("err");
      if (n > OTP_MAX) say(T(`O código tem no máximo ${OTP_MAX} dígitos. Confira o que foi colado.`, `The code has at most ${OTP_MAX} digits. Check what was pasted.`));
      else if (/[^\d\s-]/.test(box.value)) say(T("Use só os números do código.", "Use only the code's digits."));
      else if ($("iwSiMsg").dataset.keep !== "1") say("");
      $("iwSiMsg").dataset.keep = "";
    };
    let before = 0;
    box.addEventListener("input", () => {
      const n = digits().length, whole = before < 2 && n >= OTP_MIN && n <= OTP_MAX && !/[^\d\s-]/.test(box.value);
      before = n; sync();
      if (whole && !go.disabled) $("iwSiForm").requestSubmit();
    });
    // resend, after the provider's minimum wait between e-mails
    const again = $("iwSiAgain");
    const tick = () => {
      if (!sheet.open || !document.contains(again)) return;
      const left = Math.max(0, RESEND_WAIT - Math.floor((Date.now() - sentAt) / 1000));
      again.disabled = left > 0;
      again.textContent = left > 0 ? T(`Mandar outro código em ${left} s`, `Send another code in ${left} s`) : T("Mandar outro código", "Send another code");
      if (left > 0) setTimeout(tick, 1000);
    };
    again.onclick = async () => {
      again.disabled = true;
      try { await CLOUD.requestCode(email); sentAt = Date.now(); box.value = ""; sync(); say(T("Mandamos um código novo. Use só o do e-mail mais recente.", "We sent a new code. Use only the one in the latest e-mail.")); }
      catch (e) { say(e?.status === 429 ? T("Espere um pouco antes de pedir outro código.", "Wait a little before asking for another code.") : T("Não foi possível enviar o e-mail. Confira a internet.", "Couldn't send the e-mail. Check your connection.")); }
      tick();
    };
    tick();
    const back = () => stepEmail();
    $("iwSiBack").onclick = back; $("iwSiBack2").onclick = back;
    $("iwSiForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      if (go.disabled) return;
      go.setAttribute("aria-busy", "true"); go.disabled = true;
      try { await CLOUD.verify(email, digits()); window.INKWELL_TRACK("signin_done"); if (canOfferPasskey()) { try { sessionStorage.setItem(PK_NOW, "1"); } catch { /* */ } } location.reload(); }
      catch (err) {
        go.removeAttribute("aria-busy"); box.classList.add("err"); box.focus(); box.select?.();
        $("iwSiMsg").dataset.keep = "1"; sync();
        say(err?.status === 429 ? T("Muitas tentativas. Espere um pouco e tente de novo.", "Too many tries. Wait a little and try again.")
          : err?.status >= 400 && err?.status < 500 ? T("Esse código não vale: está errado, expirou ou já foi usado (abrir o link do e-mail também usa o código). Peça outro.", "That code doesn't work: it's wrong, expired or already used (opening the e-mail's link uses it too). Ask for another one.")
          : T("Sem conexão com o servidor. Tente de novo.", "No connection to the server. Try again."));
      }
    });
    setTimeout(() => box.focus(), 30);
  }
  // Right after the code: "sign in faster next time?" — once per device (not again after "Agora não"), only where passkeys work.
  // Shown on the page that reloads signed in (so whatever that page does after signing in — saving a draft, a deck — runs first).
  const PK_ASKED = "inkwell-passkey-offer", PK_NOW = "inkwell-passkey-offer-now";
  const canOfferPasskey = () => { let asked = null; try { asked = localStorage.getItem(PK_ASKED); } catch { /* */ } return !asked && !!CLOUD.passkeySupported?.(); };
  function offerPasskey(tries = 0) {
    if (!canOfferPasskey()) return false;
    if (document.querySelector("dialog[open]")) { if (tries < 10) setTimeout(() => offerPasskey(tries + 1), 3000); return false; }   // after what the page opened
    const done = (v) => { try { localStorage.setItem(PK_ASKED, v); } catch { /* */ } sheet.close(); };
    sheet.innerHTML = `<div class="grab"></div>
      <div class="sheet-head"><div><h2 id="iwSiT">${T("Entrar mais rápido da próxima vez?", "Sign in faster next time?")}</h2><div class="sub">${T("Você entrou.", "You're in.")}</div></div></div>
      <div class="sheet-body"><p>${T("Crie uma passkey: na próxima vez você entra com Face ID, digital ou a senha do aparelho, sem esperar o e-mail.", "Create a passkey: next time you sign in with Face ID, fingerprint or the device's lock, without waiting for the e-mail.")}</p>
        <p class="small muted">${T("Fica guardada no seu aparelho (e no iCloud ou na conta Google, se você usa). O código por e-mail continua valendo. Você apaga quando quiser em Perfil.", "It's kept on your device (and in iCloud or your Google account, if you use them). The e-mail code still works. Delete it any time in Profile.")}</p>
        <p class="small" id="iwSiMsg" role="alert"></p></div>
      <div class="sheet-foot"><button type="button" class="btn ghost" id="iwPkNo">${T("Agora não", "Not now")}</button><button type="button" class="btn primary" id="iwPkYes" data-testid="passkey-create">${T("Criar passkey", "Create a passkey")}</button></div>`;
    if (!sheet.open) sheet.showModal();
    $("iwPkNo").onclick = () => done("no");
    $("iwPkYes").onclick = async (ev) => {
      const b = ev.currentTarget; b.setAttribute("aria-busy", "true"); b.disabled = true;
      try { await CLOUD.passkeyRegister(); window.INKWELL_TRACK("passkey_created"); done("yes"); }
      catch (err) { b.removeAttribute("aria-busy"); b.disabled = false; $("iwSiMsg").textContent = err?.name === "NotAllowedError" ? T("Cancelado. Você pode criar depois em Perfil.", "Cancelled. You can create one later in Profile.") : T("Não foi possível criar agora. Você pode tentar depois em Perfil.", "Couldn't create it now. You can try later in Profile."); }
    };
    return true;
  }
  function wireClose() { sheet.querySelectorAll("[data-close]").forEach((b) => b.addEventListener("click", () => sheet.close())); }
  sheet.addEventListener("close", () => { trigger?.focus?.(); trigger = null; });
  sheet.addEventListener("click", (e) => { if (e.target === sheet) sheet.close(); });   // tap on the backdrop
  window.INKWELL_SIGNIN = () => {
    if (!CLOUD) return;
    window.INKWELL_TRACK("signin_open");
    trigger = document.activeElement;
    stepEmail();
    if (!sheet.open) sheet.showModal();
  };
  $("iwSignIn")?.addEventListener("click", () => window.INKWELL_SIGNIN());
  if (CLOUD?.status().signedIn) { let now = null; try { now = sessionStorage.getItem(PK_NOW); sessionStorage.removeItem(PK_NOW); } catch { /* */ } if (now) setTimeout(() => offerPasskey(), 1200); }
  // Came back from an e-mail link that no longer works: say why and offer a new code, once.
  if (window.INKWELL_LINK_FAILED && CLOUD && !CLOUD.status().signedIn) {
    setTimeout(() => {
      window.INKWELL_SIGNIN();
      stepEmail(T("O link do e-mail não vale mais: ele já foi usado ou expirou. Alguns e-mails, como Outlook e Hotmail, abrem os links sozinhos para verificar. Peça um código novo e digite-o aqui.",
        "The e-mail link no longer works: it was already used or expired. Some mail services, like Outlook and Hotmail, open links by themselves to scan them. Ask for a new code and type it here."));
    }, 50);
  }

  // ---------- guest draft (Começar meu Inkwell, behind INKWELL_FLAGS.guestProfile) ----------
  if ((window.INKWELL_FLAGS || {}).guestProfile && page !== "start") {
    const main = document.querySelector("main");
    const note = (html, id) => { if (!main || document.getElementById(id)) return; const d = document.createElement("div"); d.id = id; d.className = "notice"; d.setAttribute("role", "status"); d.innerHTML = html; main.prepend(d); };
    let draft = null; try { draft = JSON.parse(localStorage.getItem("inkwell-guest-draft-v1") || "null"); } catch { /* */ }
    if (draft && Date.now() - Date.parse(draft.updatedAt || 0) > 864e5) draft = null;   // kept for a day (comecar)
    // the draft lives in this browser for a day: other pages remind, never ask
    if (draft && typeof draft === "object") note(`<span>${T("Seu Inkwell ainda não foi salvo.", "Your Inkwell isn't saved yet.")}</span> <a href="../comecar/">${T("Continuar", "Continue")}</a>`, "iwDraftNote");
    // opened by the e-mail link: if the tab with the draft is still open, send the person back there
    if (window.INKWELL_FROM_LINK && "BroadcastChannel" in window) {
      const bc = new BroadcastChannel("inkwell-guest");
      bc.addEventListener("message", (e) => { if (e.data?.type === "here") note(T("Volte à aba em que você começou para salvar suas alterações.", "Return to the tab where you started to save your changes."), "iwOtherTab"); });
      bc.postMessage({ type: "ping" });
    }
  }

  // ---------- Trocas count, name, last duels.ink sync (best effort) ----------
  window.INKWELL_SHELL_BADGE = (n) => {
    document.querySelectorAll("[data-trades-count]").forEach((c) => {
      c.hidden = !n; c.textContent = n > 9 ? "9+" : String(n || "");
      const a = c.closest("a, button");
      if (a) a.setAttribute("aria-label", a.id === "iwMore" ? `${T("Mais", "More")}${n ? ` · ${n} ${T("trocas aguardando você", "trades waiting for you")}` : ""}` : `${T("Trocas", "Trades")}${n ? ` · ${n} ${T("aguardando você", "waiting for you")}` : ""}`);
    });
  };
  if (me && CLOUD) {
    CLOUD.api("rpc/my_profile", { method: "POST", body: {} })   // supabase/my_inkwell.sql
      .then((p) => { profileName = p?.display_name || ""; isAdmin = !!p?.is_admin; if (p?.invite_code) myInvite = { code: p.invite_code, handle: p.handle, pub: !!p.is_public }; return profileName ? null : CLOUD.api(`profiles?user_id=eq.${me.id}&select=display_name`); })
      .catch(() => CLOUD.api(`profiles?user_id=eq.${me.id}&select=display_name`))
      .then((r) => { if (r) profileName = r?.[0]?.display_name || ""; if (profileName) $("iwAv").textContent = profileName.trim()[0].toUpperCase(); })
      .catch(() => {});
    CLOUD.api("rpc/my_home", { method: "POST", body: {} }).then((h) => {
      if (!h) return;
      let since = seenAt();
      if (!since) { window.INKWELL_MARK_SEEN(); since = Date.now(); }   // first visit: only what comes after counts
      news = { wants: news?.wants || 0, requests: (h.friend_requests || []).length, recados: +h.recados_waiting || 0,
        posts: (h.community_posts || []).filter((p) => !p.mine && Date.parse(p.at) > since).length };
      if (page === "feed") news.posts = 0;   // Início shows them in "Para você"
      showNews();
    }).catch(() => {});
    // Someone put a card I want (my wishlist or my "I want" posts) on the trade board: count the new ones.
    const WANT_KEY = `inkwell-wantseen-${me.id}`;
    window.INKWELL_WANTS_SEEN = () => { try { localStorage.setItem(WANT_KEY, new Date().toISOString()); } catch { /* */ } if (news) { news.wants = 0; showNews(); } };
    (async () => {
      if (page === "trades") return;
      const [cols, mine] = await Promise.all([
        CLOUD.api("inkwell_profiles?select=wishlist:data->wishlist").catch(() => []),
        CLOUD.api(`listings?user_id=eq.${me.id}&kind=in.(buy,borrow)&select=card_id`).catch(() => []),
      ]);
      const ids = [...new Set([...(cols || []).flatMap((c) => (c.wishlist && typeof c.wishlist === "object" ? Object.keys(c.wishlist) : [])), ...(mine || []).map((l) => l.card_id)])]
        .filter((id) => /^[A-Za-z0-9-]+$/.test(id));
      if (!ids.length) return;
      let since = ""; try { since = localStorage.getItem(WANT_KEY) || ""; } catch { /* */ }
      let n = 0;
      for (let i = 0; i < ids.length && i < 600; i += 60) {
        const q = `listings?kind=in.(lend,sell,trade)&user_id=neq.${me.id}&card_id=in.(${ids.slice(i, i + 60).map((x) => `"${x}"`).join(",")})${since ? `&created_at=gt.${encodeURIComponent(since)}` : ""}&select=id&limit=100`;
        n += ((await CLOUD.api(q).catch(() => [])) || []).length;
      }
      news = news || { requests: 0, recados: 0, posts: 0 }; news.wants = n; showNews();
    })();
    // Notifications (supabase/social.sql): likes, comments, "Vou" on my tables, new tables in my communities.
    let notes = null;
    const NK = { like: ["curtiu seu post", "liked your post"], comment: ["comentou no seu post", "commented on your post"], reply: ["respondeu seu comentário", "replied to your comment"],
      comment_like: ["curtiu seu comentário", "liked your comment"], feedback: ["mandou um feedback", "sent feedback"], rsvp: ["vai na sua mesa", "is going to your table"], event: ["marcou uma mesa", "set up a table"],
      community_invite: ["convidou você para uma comunidade", "invited you to a community"], join_request: ["pediu para entrar", "asked to join"], join_accepted: ["aceitou seu pedido", "accepted your request"],
      event_soon: ["é amanhã ou hoje", "is coming up"], share_accepted: ["aceitou dividir a sua coleção", "joined your shared collection"],
      loan_request: ["pediu cartas emprestadas", "asked to borrow cards"], loan_offer: ["quer emprestar cartas para você", "offered to lend you cards"] };
    const noteHref = (n) => n.kind === "feedback" ? "../admin/?tab=feedback" : /^loan_/.test(n.kind) ? "../trades/" : n.kind === "share_accepted" ? "../colecao/" : (n.kind === "event_soon" && n.ref?.rph) || /^event_near/.test(n.kind) ? "../eventos/" : n.ref?.post ? `../feed/#post-${encodeURIComponent(n.ref.post)}` : n.ref?.slug ? `../comunidades/?c=${encodeURIComponent(n.ref.slug)}${["event", "rsvp", "event_soon"].includes(n.kind) ? "#mesas" : ""}` : "../feed/";
    // the number on the app icon (installed app): the unread count, cleared when read
    const appBadge = (n) => { try { if (n && navigator.setAppBadge) navigator.setAppBadge(n).catch(() => {}); else if (navigator.clearAppBadge) navigator.clearAppBadge().catch(() => {}); } catch { /* */ } };
    const showBell = () => { const b = $("iwBell"), c = $("iwBellN"); if (!b || !notes) return; b.hidden = false; const n = notes.filter((x) => x.unread).length; c.hidden = !n; c.textContent = n > 9 ? "9+" : String(n); appBadge(n);
      b.setAttribute("aria-label", n ? T(`Notificações · ${n} novas`, `Notifications · ${n} new`) : T("Notificações", "Notifications")); };
    CLOUD.api("rpc/my_notifications", { method: "POST", body: {} }).then((r) => { notes = r || []; showBell(); }).catch(() => {});   // not there yet: no bell
    // Push on this device (supabase/push.sql + functions/push-send; the worker is site/push/sw.js)
    const VAPID = "BLvoLCTQgS3n-1MGGoQXBZ3OO50n_-mWuhLqRbWFVK38DvLNVEK3IOO_CCSMxDkq2AoRCiInC9R4mrEM23pWQdk";
    const pushOk = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window && (location.protocol === "https:" || location.hostname === "localhost");
    const iosBrowser = /iP(hone|ad|od)/.test(navigator.userAgent) && !(navigator.standalone || matchMedia("(display-mode: standalone)").matches);
    const b64 = (s) => { const p = "=".repeat((4 - (s.length % 4)) % 4), raw = atob((s + p).replace(/-/g, "+").replace(/_/g, "/")); return Uint8Array.from(raw, (c) => c.charCodeAt(0)); };
    const pushReg = () => navigator.serviceWorker.register("../push/sw.js", { scope: "../push/" });
    // state(): "on" | "off" | "denied" | "ios" (needs the Home Screen app) | "unsupported"; on()/off() throw on failure
    async function pushSub() { try { return await (await navigator.serviceWorker.getRegistration("../push/"))?.pushManager.getSubscription() || null; } catch { return null; } }
    async function pushState() {
      if (iosBrowser) return "ios";
      if (!pushOk) return "unsupported";
      if (Notification.permission === "denied") return "denied";
      return (await pushSub()) ? "on" : "off";
    }
    async function pushOn() {
      if ((await Notification.requestPermission()) !== "granted") return false;
      const reg = await pushReg();   // not .ready: this page isn't in the worker's scope, so .ready never settles
      const w = reg.installing || reg.waiting;
      if (w && !reg.active) await new Promise((ok) => { w.addEventListener("statechange", () => { if (w.state === "activated") ok(); }); setTimeout(ok, 8000); });
      const s2 = (await reg.pushManager.getSubscription()) || await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64(VAPID) });
      const j = s2.toJSON();
      await CLOUD.api("rpc/save_push_sub", { method: "POST", body: { p_endpoint: j.endpoint, p_p256dh: j.keys.p256dh, p_auth: j.keys.auth, p_ua: navigator.userAgent.slice(0, 200) } });
      return true;
    }
    async function pushOff() {
      const sub = await pushSub(); if (!sub) return;
      await CLOUD.api("rpc/delete_push_sub", { method: "POST", body: { p_endpoint: sub.endpoint } }).catch(() => {});
      await sub.unsubscribe();
    }
    window.INKWELL_PUSH = { state: pushState, on: pushOn, off: pushOff };   // Meu Inkwell › Avisos uses the same switch
    const PUSH_TEXT = {
      ios: () => T("Para receber avisos no iPhone: toque em Compartilhar → Adicionar à Tela de Início, abra o Inkwell por lá e ative aqui.", "To get notices on iPhone: Share → Add to Home Screen, open Inkwell from there and turn them on here."),
      unsupported: () => T("Este navegador não recebe avisos.", "This browser can't receive notices."),
      denied: () => T("Os avisos estão bloqueados nas configurações do navegador para este site.", "Notices are blocked for this site in the browser settings."),
    };
    async function drawPush() {
      const el = $("iwPush"); if (!el) return;
      const st = await pushState(), cfg = `<a class="small" href="../perfil/#avisos" data-testid="notif-settings">${T("Configurar avisos", "Notice settings")}</a>`;
      if (PUSH_TEXT[st]) { el.innerHTML = `<p class="small muted">${PUSH_TEXT[st]()}</p>${cfg}`; return; }
      el.innerHTML = st === "on" ? `<span class="small"><i class="ic i-bell"></i> ${T("Avisos ligados neste aparelho", "Notices on for this device")}</span><button type="button" class="btn ghost small" data-push="off">${T("Desligar", "Turn off")}</button>${cfg}`
        : `<button type="button" class="btn small primary" data-push="on"><i class="ic i-bell"></i>${T("Avisar neste aparelho", "Notify me on this device")}</button>${cfg}`;
      el.querySelector("[data-push]").onclick = async (ev) => {
        ev.stopPropagation(); const b = ev.currentTarget; b.disabled = true;
        try { if (b.dataset.push === "on") await pushOn(); else await pushOff(); }
        catch { el.insertAdjacentHTML("beforeend", `<p class="small" style="color:var(--loss)">${T("Não deu certo. Tente de novo.", "That didn't work. Try again.")}</p>`); b.disabled = false; return; }
        drawPush();
      };
    }
    $("iwBell")?.addEventListener("click", (e) => {
      const list = [], cl = new Map();
      for (const n of notes || []) {
        if (n.kind !== "comment_like" || !n.ref?.comment) { list.push(n); continue; }
        const g = cl.get(n.ref.comment);
        if (g) { g.others++; g.unread = g.unread || n.unread; } else { const x = { ...n, others: 0 }; cl.set(n.ref.comment, x); list.push(x); }
      }
      openMenu(e.currentTarget, `<div class="menu-label">${T("Notificações", "Notifications")}</div>${list.length ? list.map((n) => `<a class="menu-item${n.unread ? " unread" : ""}" role="menuitem" href="${noteHref(n)}"><span>${n.kind === "event_near" ? `<b>${T("Evento novo perto de você", "New event near you")}:</b> ${esc(n.ref?.text || "")}${n.ref?.store || n.ref?.at ? `<small>${esc([n.ref.store, n.ref.at ? new Date(n.ref.at).toLocaleString(lang === "en" ? "en" : "pt-BR", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : ""].filter(Boolean).join(" · "))}</small>` : ""}`
        : n.kind === "event_near_many" ? `<b>${esc(T(`${n.ref?.n || "Vários"} eventos novos perto de você`, `${n.ref?.n || "Several"} new events near you`))}</b>${n.ref?.text ? ` ${esc(T("em", "in"))} ${esc(n.ref.text)}` : ""}`
        : n.kind === "event_soon" ? `<b>${T("Lembrete", "Reminder")}:</b> ${esc(n.ref?.text || T("seu evento", "your event"))} ${esc(T(...NK.event_soon))}` : n.kind === "comment_like" && n.others ? `<b>${esc(n.name || T("Alguém", "Someone"))}</b> ${esc(T(`e mais ${n.others} curtiram seu comentário`, `and ${n.others} more liked your comment`))}` : `<b>${esc(n.name || T("Alguém", "Someone"))}</b> ${esc(T(...(NK[n.kind] || ["", ""])))}`}${!/^event_(soon|near)/.test(n.kind) && (n.ref?.text || n.ref?.name) ? `<small>${esc(n.ref.text || n.ref.name)}</small>` : ""}<small>${esc(new Date(n.at).toLocaleString(lang === "en" ? "en" : "pt-BR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }))}</small></span></a>`).join("") : `<div class="menu-item" style="pointer-events:none"><span class="small">${T("Nada por aqui ainda.", "Nothing here yet.")}</span></div>`}<div class="push-row" id="iwPush"></div>`, "notif");
      drawPush();
      if (list.some((n) => n.unread)) CLOUD.api("rpc/read_notifications", { method: "POST", body: {} }).then(() => { [...list, ...(notes || [])].forEach((n) => { n.unread = false; }); showBell(); }).catch(() => {});
    });
    // Global search (supabase/search_privacy.sql): people with a public profile or my friends, and communities
    const findBtn = $("iwFind");
    const openFind = () => {
      if (!findBtn) return;
      openMenu(findBtn, `<div class="find" data-testid="find"><input type="search" id="iwFindQ" placeholder="${T("Buscar pessoas e comunidades", "Search people and communities")}" aria-label="${T("Buscar pessoas e comunidades", "Search people and communities")}" autocomplete="off" maxlength="60"><div id="iwFindR" aria-live="polite"><p class="small muted">${T("Digite pelo menos 2 letras.", "Type at least 2 letters.")}</p></div></div>`, "find-menu");
      const q = $("iwFindQ"), out = $("iwFindR"); let t = 0, seq = 0; q.focus();
      const ini = (n) => esc(String(n || "?").trim().charAt(0).toUpperCase() || "?");
      const sec = (title, rows) => rows.length ? `<div class="menu-label">${title}</div>${rows.join("")}` : "";
      q.addEventListener("input", () => { clearTimeout(t); t = setTimeout(async () => {
        const v = q.value.trim(), my = ++seq;
        if (v.length < 2) { out.innerHTML = `<p class="small muted">${T("Digite pelo menos 2 letras.", "Type at least 2 letters.")}</p>`; return; }
        out.innerHTML = `<p class="small muted">${T("Buscando…", "Searching…")}</p>`;
        let r = null; try { r = await CLOUD.api("rpc/search_all", { method: "POST", body: { p_q: v } }); } catch { r = null; }
        if (my !== seq) return;
        if (!r) { out.innerHTML = `<p class="small muted">${T("A busca ainda não está disponível.", "Search isn't available yet.")}</p>`; return; }
        const people = (r.people || []).map((p) => `<a class="menu-item" role="menuitem" href="${p.handle ? `../perfil/?u=${encodeURIComponent(p.handle)}` : "../feed/#amigos"}"><span class="av sm">${ini(p.name)}</span><span><b>${esc(p.name || "")}</b><small>${esc([p.handle ? "@" + p.handle : "", p.friend ? T("Amigo", "Friend") : "", p.city || ""].filter(Boolean).join(" · "))}</small></span></a>`);
        const comms = (r.communities || []).map((c) => `<a class="menu-item" role="menuitem" href="../comunidades/?c=${encodeURIComponent(c.slug)}"><span class="av sm"><i class="ic i-users"></i></span><span><b>${esc(c.name)}</b><small>${esc([c.city, c.mine ? T("Você participa", "You're a member") : ""].filter(Boolean).join(" · "))}</small></span></a>`);
        out.innerHTML = sec(T("Pessoas", "People"), people) + sec(T("Comunidades", "Communities"), comms) || `<p class="small muted">${T("Nada encontrado.", "Nothing found.")}</p>`;
      }, 250); });
    };
    findBtn?.addEventListener("click", openFind);
    document.addEventListener("keydown", (e) => { if (e.key === "/" && !e.ctrlKey && !e.metaKey && !/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName || "") && !document.activeElement?.isContentEditable && !$("iwFindQ")) { e.preventDefault(); openFind(); } });
    // an invite link opened before signing in (perfil/?convite=…): accept it on whichever page the sign-in lands
    let inv = null; try { inv = localStorage.getItem("inkwell-invite"); } catch { /* */ }
    if (inv && page !== "profile") {
      try { localStorage.removeItem("inkwell-invite"); } catch { /* */ }
      CLOUD.api("rpc/accept_invite", { method: "POST", body: { p_code: inv } }).catch(() => {});
    }
    Promise.all([
      CLOUD.api(`user_loans?select=id&status=eq.requested&created_by=neq.${me.id}`).catch(() => []),
      CLOUD.api(`user_trades?select=id&status=eq.proposed&partner=eq.${me.id}`).catch(() => []),
    ]).then(([a, b]) => { if (page !== "trades") window.INKWELL_SHELL_BADGE((a || []).length + (b || []).length); });
    CLOUD.api("rpc/my_duels_sync", { method: "POST", body: {} }).then((r) => {
      const t = Date.parse(r?.[0]?.last_run_at); if (!t) return;
      const m = Math.max(0, Math.round((Date.now() - t) / 60000));
      syncAgo = m < 1 ? T("agora", "now") : m < 60 ? T(`há ${m} min`, `${m} min ago`) : T(`há ${Math.round(m / 60)} h`, `${Math.round(m / 60)} h ago`);
    }).catch(() => {});
  }

  // ---------- tap a card thumbnail to see it large (any page; not where the thumbnail is already a button or link) ----------
  const zoom = document.createElement("dialog");
  zoom.className = "iw-zoom-card"; zoom.id = "iwZoom"; zoom.setAttribute("aria-label", T("Carta ampliada", "Card, larger"));
  zoom.innerHTML = `<button type="button" class="btn ghost icon" data-zclose aria-label="${T("Fechar", "Close")}"><i class="ic i-close"></i></button><figure><img alt=""><figcaption></figcaption></figure><div class="iw-zoom-extra" hidden></div>`;
  document.body.append(zoom);
  // a tap anywhere closes it — except on what a page put under the card (window.INKWELL_ZOOM_EXTRA, e.g. Decks: your copies)
  zoom.addEventListener("click", (e) => { if (!e.composedPath().some((x) => x.classList?.contains("iw-zoom-extra"))) zoom.close(); });   // the path, not target: a button there may have been redrawn
  const zoomable = (el) => { const t = el.closest?.(".thumb, .iw-card"); if (!t || !t.querySelector("img") || t.closest("a, button, label, summary, dialog.iw-dialog, #iwZoom, [role=button], [data-nozoom]")) return null; return t; };
  document.addEventListener("click", (e) => {
    const t = zoomable(e.target); if (!t) return;
    const img = t.querySelector("img");
    e.preventDefault(); e.stopPropagation();
    zoom.querySelector("img").src = img.currentSrc || img.src;
    zoom.querySelector("img").alt = img.alt || "";
    zoom.querySelector("figcaption").textContent = img.alt || "";
    zoom.querySelector("figcaption").hidden = !img.alt;
    const extra = zoom.querySelector(".iw-zoom-extra"); extra.replaceChildren();
    let more = null; try { more = window.INKWELL_ZOOM_EXTRA?.(t, () => zoom.close()) || null; } catch { /* the card still opens */ }
    if (more) extra.append(more);
    extra.hidden = !more; zoom.classList.toggle("has-extra", !!more);
    zoom.showModal();
  }, true);
  document.addEventListener("mouseover", (e) => { const t = zoomable(e.target); if (t) t.style.cursor = "zoom-in"; });
})();
