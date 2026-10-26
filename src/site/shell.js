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
    menu.querySelector("[data-signout]")?.addEventListener("click", () => {
      try { sessionStorage.removeItem("inkwell-guest-intent-v1"); } catch { /* */ }   // signing out cancels a pending "save after sign-in"; the draft stays
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

  // ---------- sign-in sheet: e-mail → code from the e-mail (or the link in it) ----------
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
      try { await CLOUD.requestCode(email); sentAt = Date.now(); stepCode(); }
      catch { b.removeAttribute("aria-busy"); b.disabled = false; $("iwSiMsg").textContent = T("Não foi possível enviar o e-mail. Confira o endereço e a internet.", "Couldn't send the e-mail. Check the address and your connection."); }
    });
    setTimeout(() => $("iwSiEmail")?.focus(), 30);
  }
  // The e-mail code: Supabase sends 6 to 10 digits (Authentication → Providers → Email → "Email OTP Length").
  // One field takes the whole code, typed or pasted, and never cuts it; nothing is sent until "Entrar".
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
    box.addEventListener("input", sync);
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
      try { await CLOUD.verify(email, digits()); location.reload(); }
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

  // ---------- guest draft (Começar meu Inkwell, behind INKWELL_FLAGS.guestProfile) ----------
  if ((window.INKWELL_FLAGS || {}).guestProfile && page !== "start") {
    const main = document.querySelector("main");
    const note = (html, id) => { if (!main || document.getElementById(id)) return; const d = document.createElement("div"); d.id = id; d.className = "notice"; d.setAttribute("role", "status"); d.innerHTML = html; main.prepend(d); };
    let draft = null; try { draft = JSON.parse(sessionStorage.getItem("inkwell-guest-draft-v1") || "null"); } catch { /* */ }
    // the draft lives in this tab: other pages remind, never ask
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
