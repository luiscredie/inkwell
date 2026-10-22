/* Inkwell site shell (design v2, Noite): app bar, phone tab bar, account menu and the one sign-in sheet.
   Markup and classes follow packages/ui/tokens.css (§4 Shell, §11 Sheet); see DESIGN-CHANGES.md.
   Pages set window.INKWELL_SHELL = { page: "feed" | "cards" | "decks" | "coach" | "trades" } and may call:
     window.INKWELL_SIGNIN()            open the sign-in sheet
     window.INKWELL_SHELL_BADGE(n)      set the Trocas count (requests waiting for me)
   Sign-in uses window.INKWELL_CLOUD (cloud.js): one session for the whole site. */
(() => {
  "use strict";
  let lang = "pt";
  try { lang = localStorage.getItem("inkwell-lang") || ((navigator.language || "pt").toLowerCase().startsWith("en") ? "en" : "pt"); } catch { /* */ }
  const pt = lang === "pt";
  const T = (p, e) => (pt ? p : e);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const page = (window.INKWELL_SHELL || {}).page || "";
  const UI = "../ui/";
  const CLOUD = window.INKWELL_CLOUD;
  const me = CLOUD?.user();
  const NAV = [
    ["feed", "../feed/", T("Início", "Home"), "home"],
    ["cards", "../colecao/", T("Coleção", "Collection"), "cards"],
    ["decks", "../decks/", "Decks", "decks"],
    ["coach", "../coach/", T("Jogos", "Games"), "games"],
    ["trades", "../trades/", T("Trocas", "Trades"), "trades"],
  ];
  const cur = (k) => (k === page ? ' aria-current="page"' : "");

  const bar = document.createElement("header");
  bar.className = "appbar";
  bar.innerHTML = `<div class="appbar-in"><a class="brand" href="../feed/"><img src="${UI}assets/logo-mark.svg" alt="">Inkwell</a>
    <nav class="sections" aria-label="${T("Seções", "Sections")}">${NAV.map(([k, href, label, ic]) => `<a href="${href}"${cur(k)} data-iw="${k}"><i class="ic i-${ic}"></i>${label}</a>`).join("")}</nav>
    <div class="end">
      <a class="btn ghost counter-btn" href="../counter/" aria-label="${T("Abrir o Contador", "Open the Counter")}"><i class="ic i-counter"></i><span>${T("Contador", "Counter")}</span></a>
      ${me ? `<button type="button" class="av-btn" id="iwAcct" aria-label="${T("Sua conta", "Your account")}" aria-haspopup="menu" aria-expanded="false"><span class="av" id="iwAv">${esc((me.email || "?")[0].toUpperCase())}</span><span class="count iw-badge" id="iwBadge" hidden></span></button>`
        : `<button type="button" class="btn ghost icon" id="iwLangBtn" aria-label="${T("Aparência e idioma", "Appearance and language")}" aria-haspopup="menu" aria-expanded="false"><i class="ic i-globe"></i></button>
           <button type="button" class="btn small" id="iwSignIn">${T("Entrar", "Sign in")}</button>`}
    </div></div>`;
  document.body.prepend(bar);
  const tabs = document.createElement("nav");
  tabs.className = "tabbar";
  tabs.setAttribute("aria-label", T("Seções", "Sections"));
  tabs.innerHTML = NAV.map(([k, href, label, ic]) => `<a href="${href}"${cur(k)} data-iw="${k}"><i class="pip"><i class="ic i-${ic}"></i></i>${label}${k === "trades" ? '<span class="count" id="iwTradesCount" hidden></span>' : ""}</a>`).join("");
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
    menu.querySelector("[data-signout]")?.addEventListener("click", () => { CLOUD?.signOut(); location.reload(); });
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
  let profileName = "", syncAgo = "", isAdmin = false, news = null;
  // Notices: friend requests, recados waiting for approval, new posts in your communities (supabase/my_account.sql my_home).
  // "New" posts are the ones after you last opened Início (kept per account in this browser).
  const SEEN_KEY = me ? `inkwell-seen-${me.id}` : "";
  const seenAt = () => { try { return Date.parse(localStorage.getItem(SEEN_KEY) || "") || 0; } catch { return 0; } };
  window.INKWELL_MARK_SEEN = () => { try { localStorage.setItem(SEEN_KEY, new Date().toISOString()); } catch { /* */ } if (news) { news.posts = 0; showNews(); } };
  function showNews() {
    const b = $("iwBadge"); if (!b || !news) return;
    const n = news.requests + news.recados + news.posts;
    b.hidden = !n; b.textContent = n > 9 ? "9+" : String(n);
    $("iwAcct")?.setAttribute("aria-label", n ? T(`Sua conta · ${n} novidades`, `Your account · ${n} new`) : T("Sua conta", "Your account"));
  }
  const newsMenu = () => {
    if (!news || !(news.requests + news.recados + news.posts)) return "";
    const item = (href, ic, text, n) => (n ? `<a class="menu-item" role="menuitem" href="${href}"><i class="ic i-${ic}"></i>${text}<span class="trail"><span class="count">${n}</span></span></a>` : "");
    return `<div class="menu-sep"></div><div class="menu-label">${T("Novidades", "New for you")}</div>
      ${item("../feed/#amigos", "user-plus", news.requests === 1 ? T("Pedido de amizade", "Friend request") : T("Pedidos de amizade", "Friend requests"), news.requests)}
      ${item("../perfil/?editar=1#recados", "comment", news.recados === 1 ? T("Recado para aprovar", "Recado to approve") : T("Recados para aprovar", "Recados to approve"), news.recados)}
      ${item("../feed/", "board", T("Mensagens nas comunidades", "Community messages"), news.posts)}`;
  };
  $("iwAcct")?.addEventListener("click", (e) => openMenu(e.currentTarget, `
    <div class="menu-head"><span class="av lg">${esc((profileName || me.email || "?")[0].toUpperCase())}</span><div class="t"><b>${esc(profileName || T("Sua conta", "Your account"))}</b><div class="small">${esc(me.email || "")}</div></div></div>
    ${newsMenu()}
    <div class="menu-sep"></div>
    <a class="menu-item" role="menuitem" href="../perfil/?editar=1"><i class="ic i-users"></i>${T("Meu Inkwell", "My Inkwell")}</a>
    <a class="menu-item" role="menuitem" href="../comunidades/"><i class="ic i-board"></i>${T("Comunidades", "Communities")}</a>
    <a class="menu-item" role="menuitem" href="../feed/#amigos"><i class="ic i-shield"></i>${T("Privacidade e amigos", "Privacy and friends")}</a>
    <a class="menu-item" role="menuitem" href="../coach/"><i class="ic i-refresh"></i>${T("Jogos do duels.ink", "duels.ink games")}${syncAgo ? `<span class="trail">${esc(syncAgo)}</span>` : ""}</a>
    ${isAdmin ? `<a class="menu-item" role="menuitem" href="../admin/"><i class="ic i-shield"></i>Admin</a>` : ""}
    <a class="menu-item" role="menuitem" href="../privacidade/"><i class="ic i-info"></i>${T("Termos e privacidade", "Terms and privacy")}</a>
    ${langSeg()}
    <div class="menu-sep"></div>
    <button type="button" class="menu-item" role="menuitem" data-signout><i class="ic i-logout"></i>${T("Sair", "Sign out")}</button>`));
  $("iwLangBtn")?.addEventListener("click", (e) => openMenu(e.currentTarget, `<div class="menu-label">${T("Idioma", "Language")}</div>
    ${[["pt", "Português"], ["en", "English"]].map(([k, l]) => `<button type="button" class="menu-item" role="menuitemradio" aria-checked="${k === lang}" data-lang-pick="${k}">${l}${k === lang ? '<i class="ic i-check" style="margin-left:auto;color:var(--text)"></i>' : ""}</button>`).join("")}
    <div class="menu-sep"></div><div class="menu-label">${T("Tema: Noite", "Theme: Night")}</div>`, "sm"));
  function $(id) { return document.getElementById(id); }

  // ---------- sign-in sheet: e-mail → 6-digit code (or the link in the e-mail) ----------
  const sheet = document.createElement("dialog");
  sheet.className = "sheet"; sheet.id = "iwSignSheet"; sheet.setAttribute("aria-labelledby", "iwSiT");
  document.body.append(sheet);
  let email = "", trigger = null;
  function stepEmail(msg = "") {
    sheet.innerHTML = `<div class="grab"></div>
      <div class="sheet-head"><div><h2 id="iwSiT">${T("Entrar no Inkwell", "Sign in to Inkwell")}</h2><div class="sub">${T("Sem senha. Mandamos um código.", "No password. We e-mail you a code.")}</div></div>
        <button type="button" class="btn ghost icon" data-close aria-label="${T("Fechar", "Close")}"><i class="ic i-close"></i></button></div>
      <div class="sheet-body"><form class="form" id="iwSiForm" novalidate>
        <label class="field">${T("E-mail", "E-mail")}<input id="iwSiEmail" type="email" inputmode="email" autocomplete="email" placeholder="voce@exemplo.com" value="${esc(email)}" required></label>
        <p class="small muted">${T("Se for a primeira vez, sua conta é criada agora. Seus jogos ficam salvos e só você decide quem vê.", "If it's your first time, your account is created now. Your games are saved and only you decide who sees them.")}</p>
        <p class="small faint">${T("Ao entrar, você concorda com os", "By signing in you agree to the")} <a href="../privacidade/">${T("Termos e a Privacidade", "Terms and Privacy")}</a>.</p>
        <p class="small" id="iwSiMsg" role="alert">${esc(msg)}</p>
      </form></div>
      <div class="sheet-foot"><button type="button" class="btn ghost" data-close>${T("Cancelar", "Cancel")}</button><button type="submit" form="iwSiForm" class="btn primary" id="iwSiSend">${T("Enviar código", "Send code")}</button></div>`;
    wireClose();
    $("iwSiForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      email = $("iwSiEmail").value.trim();
      if (!/^\S+@\S+\.\S+$/.test(email)) { $("iwSiMsg").textContent = T("Digite seu e-mail.", "Enter your e-mail."); return; }
      const b = $("iwSiSend"); b.setAttribute("aria-busy", "true"); b.disabled = true;
      try { await CLOUD.requestCode(email); stepCode(); }
      catch { b.removeAttribute("aria-busy"); b.disabled = false; $("iwSiMsg").textContent = T("Não foi possível enviar o e-mail. Confira o endereço e a internet.", "Couldn't send the e-mail. Check the address and your connection."); }
    });
    setTimeout(() => $("iwSiEmail")?.focus(), 30);
  }
  function stepCode(msg = "") {
    sheet.innerHTML = `<div class="grab"></div>
      <div class="sheet-head"><div><h2 id="iwSiT">${T("Digite o código", "Enter the code")}</h2><div class="sub">${esc(T("Enviado para ", "Sent to ") + email)}</div></div>
        <button type="button" class="btn ghost icon" data-close aria-label="${T("Fechar", "Close")}"><i class="ic i-close"></i></button></div>
      <div class="sheet-body"><form class="form" id="iwSiForm" novalidate>
        <fieldset class="field"><legend>${T("Código de 6 dígitos", "6-digit code")}</legend>
          <div class="otp">${[1, 2, 3, 4, 5, 6].map((i) => `<input inputmode="numeric" autocomplete="${i === 1 ? "one-time-code" : "off"}" aria-label="${T("Dígito", "Digit")} ${i}">`).join("")}</div>
          <span class="hint">${T("Também pode abrir o link do e-mail neste aparelho. Confira o spam.", "You can also open the link in the e-mail on this device. Check spam too.")}</span>
        </fieldset>
        <p class="small" id="iwSiMsg" role="alert">${esc(msg)}</p>
        <div class="row between small"><button type="button" class="linkbtn" id="iwSiBack">${T("Trocar e-mail", "Change e-mail")}</button></div>
      </form></div>
      <div class="sheet-foot"><button type="button" class="btn ghost" id="iwSiBack2">${T("Voltar", "Back")}</button><button type="submit" form="iwSiForm" class="btn primary" id="iwSiIn" disabled>${T("Entrar", "Sign in")}</button></div>`;
    wireClose();
    const boxes = [...sheet.querySelectorAll(".otp input")];
    const code = () => boxes.map((b) => b.value).join("");
    const sync = () => { boxes.forEach((b) => b.classList.toggle("filled", !!b.value)); $("iwSiIn").disabled = code().length !== 6; };
    boxes.forEach((b, i) => {
      b.addEventListener("input", () => {
        const d = b.value.replace(/\D/g, "");
        if (d.length > 1) { d.slice(0, 6).split("").forEach((c, j) => { if (boxes[j]) boxes[j].value = c; }); boxes[Math.min(5, d.length - 1)].focus(); }
        else { b.value = d; if (d && boxes[i + 1]) boxes[i + 1].focus(); }
        sync();
        if (code().length === 6) $("iwSiForm").requestSubmit();
      });
      b.addEventListener("keydown", (e) => { if (e.key === "Backspace" && !b.value && boxes[i - 1]) boxes[i - 1].focus(); });
    });
    const back = () => stepEmail();
    $("iwSiBack").onclick = back; $("iwSiBack2").onclick = back;
    $("iwSiForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      const b = $("iwSiIn"); b.setAttribute("aria-busy", "true"); b.disabled = true;
      try { await CLOUD.verify(email, code()); location.reload(); }
      catch { boxes.forEach((x) => { x.value = ""; x.classList.add("err"); }); boxes[0].focus(); b.removeAttribute("aria-busy"); sync(); $("iwSiMsg").textContent = T("Código errado ou expirado. Tente de novo.", "Wrong or expired code. Try again."); }
    });
    setTimeout(() => boxes[0].focus(), 30);
  }
  function wireClose() { sheet.querySelectorAll("[data-close]").forEach((b) => b.addEventListener("click", () => sheet.close())); }
  sheet.addEventListener("close", () => { trigger?.focus?.(); trigger = null; });
  sheet.addEventListener("click", (e) => { if (e.target === sheet) sheet.close(); });   // tap on the backdrop
  window.INKWELL_SIGNIN = () => {
    if (!CLOUD) return;
    trigger = document.activeElement;
    stepEmail();
    if (!sheet.open) sheet.showModal();
  };
  $("iwSignIn")?.addEventListener("click", () => window.INKWELL_SIGNIN());

  // ---------- Trocas count, name, last duels.ink sync (best effort) ----------
  window.INKWELL_SHELL_BADGE = (n) => {
    const c = $("iwTradesCount"); if (!c) return;
    c.hidden = !n; c.textContent = n > 9 ? "9+" : String(n || "");
    const a = c.closest("a"); if (a) a.setAttribute("aria-label", `${T("Trocas", "Trades")}${n ? ` · ${n} ${T("aguardando você", "waiting for you")}` : ""}`);
  };
  if (me && CLOUD) {
    CLOUD.api("rpc/my_profile", { method: "POST", body: {} })   // supabase/my_inkwell.sql
      .then((p) => { profileName = p?.display_name || ""; isAdmin = !!p?.is_admin; return profileName ? null : CLOUD.api(`profiles?user_id=eq.${me.id}&select=display_name`); })
      .catch(() => CLOUD.api(`profiles?user_id=eq.${me.id}&select=display_name`))
      .then((r) => { if (r) profileName = r?.[0]?.display_name || ""; if (profileName) $("iwAv").textContent = profileName.trim()[0].toUpperCase(); })
      .catch(() => {});
    CLOUD.api("rpc/my_home", { method: "POST", body: {} }).then((h) => {
      if (!h) return;
      let since = seenAt();
      if (!since) { window.INKWELL_MARK_SEEN(); since = Date.now(); }   // first visit: only what comes after counts
      news = { requests: (h.friend_requests || []).length, recados: +h.recados_waiting || 0,
        posts: (h.community_posts || []).filter((p) => !p.mine && Date.parse(p.at) > since).length };
      if (page === "feed") news.posts = 0;   // Início shows them in "Para você"
      showNews();
    }).catch(() => {});
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
})();
