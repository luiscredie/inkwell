/* Inkwell Lore Counter: cloud adapter for the offline app.
 *
 * Talks to the Inkwell Supabase project with plain fetch (no library to cache):
 *   sign-in   email one-time code (or the magic link, when opened in the same browser)
 *   storage   public.game_logs, one row per game, upserted on (user_id, game_id),
 *             so a retry after a dropped connection never creates a duplicate
 * The counter keeps every match locally until send() resolves true.
 * Only the public URL and publishable key are here; row-level security limits each user to their own rows.
 */
// Feature flags (off by default). ?preview=visitante turns the new guest experience on for this tab only
// (sessionStorage); ?preview=off turns it off again. Rollback = leave guestProfile false: nothing else changes.
window.INKWELL_FLAGS = (() => {
  const f = { guestProfile: false };
  try {
    const q = new URLSearchParams(location.search).get("preview");
    if (q === "visitante") sessionStorage.setItem("inkwell-preview", "visitante");
    if (q === "off") sessionStorage.removeItem("inkwell-preview");
    if (sessionStorage.getItem("inkwell-preview") === "visitante") f.guestProfile = true;
  } catch { /* storage off: flags stay as set above */ }
  return f;
})();
window.INKWELL_CLOUD = (() => {
  const cfg = window.INKWELL_CLOUD_CONFIG || {};
  if (!cfg.url || !cfg.key) return null;
  // One sign-in for the whole site: the counter, Coach Review, Início, Trocas and the Inkwell app itself
  // (its supabase-js client uses this same storage key), so signing in or out on one page does it on all.
  const KEY = "inkwell-counter-auth";
  const load = () => { try { return JSON.parse(localStorage.getItem(KEY) || "null"); } catch { return null; } };
  let sess = load();
  const store = (x) => { sess = x; try { if (x) localStorage.setItem(KEY, JSON.stringify(x)); else localStorage.removeItem(KEY); } catch { /* private mode */ } };
  const headers = (tok) => ({ apikey: cfg.key, "Content-Type": "application/json", ...(tok ? { Authorization: `Bearer ${tok}` } : {}) });
  const claims = (jwt) => { try { return JSON.parse(atob(jwt.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))); } catch { return {}; } };
  const session = (r) => {   // the same shape supabase-js keeps, so both read each other's session
    const c = claims(r.access_token);
    const expires_at = r.expires_at || c.exp || Math.floor(Date.now() / 1000) + (r.expires_in || 3600);
    return { access_token: r.access_token, refresh_token: r.refresh_token, token_type: "bearer",
      expires_in: r.expires_in || Math.max(0, expires_at - Math.floor(Date.now() / 1000)), expires_at,
      user: { ...(r.user || {}), id: r.user?.id || c.sub, email: r.user?.email || c.email } };
  };

  // Magic link opened in this same browser: tokens arrive in the URL fragment.
  const h = new URLSearchParams(location.hash.slice(1));
  if (h.get("access_token") && h.get("refresh_token")) {
    store(session({ access_token: h.get("access_token"), refresh_token: h.get("refresh_token"), expires_in: +h.get("expires_in") || 3600 }));
    history.replaceState(null, "", location.pathname + location.search);
    window.INKWELL_FROM_LINK = true;   // this tab was opened by the e-mail link (the guest editor tells the original tab apart)
  } else if (h.get("error_code") || h.get("error")) {
    // The e-mail link didn't work (already used or expired): Supabase sends back #error=…&error_code=otp_expired.
    // Some mail services (Outlook/Hotmail) open links by themselves to scan them, which uses the link up.
    history.replaceState(null, "", location.pathname + location.search);
    window.INKWELL_LINK_FAILED = h.get("error_code") || h.get("error");
  }

  async function token() {
    sess = load();   // another page (or the Inkwell app) may have signed in, out, or refreshed the tokens meanwhile
    if (!sess) return null;
    if (sess.expires_at - 60 > Date.now() / 1000) return sess.access_token;
    const used = sess.refresh_token;
    const r = await fetch(`${cfg.url}/auth/v1/token?grant_type=refresh_token`, { method: "POST", headers: headers(), body: JSON.stringify({ refresh_token: used }) });
    if (r.status === 400 || r.status === 401) {
      const now = load();   // a page that refreshed at the same moment already saved newer tokens: keep them
      if (now && now.refresh_token !== used && now.expires_at - 60 > Date.now() / 1000) { sess = now; return sess.access_token; }
      store(null); return null;   // signed out elsewhere
    }
    if (!r.ok) throw new Error(`refresh ${r.status}`);
    store(session(await r.json()));
    return sess.access_token;
  }

  // Authenticated call to the database's REST API (used by Coach Review). Errors carry a short code.
  async function api(path, { method = "GET", body, prefer } = {}) {
    const tok = await token();
    if (!tok) throw Object.assign(new Error("signed out"), { code: "auth" });
    const r = await fetch(`${cfg.url}/rest/v1/${path}`, {
      method, headers: { ...headers(tok), ...(prefer ? { Prefer: prefer } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    if (r.status === 401) store({ ...sess, expires_at: 0 });
    if (!r.ok) {
      const code = r.status === 401 || r.status === 403 ? "permission" : r.status === 400 || r.status === 409 || r.status === 413 ? "invalid_argument" : "unavailable";
      throw Object.assign(new Error(`${method} ${path.split("?")[0]} ${r.status}`), { code, status: r.status });
    }
    const text = await r.text();
    return text ? JSON.parse(text) : null;
  }

  // The player's collections (public.inkwell_profiles). A new account has none yet, and every collection, deck
  // and wishlist save needs one, so the first visit creates an empty "principal" collection, then reads again.
  async function collections(select) {
    const q = `inkwell_profiles?select=${select}&order=updated_at.desc`;
    const r = await api(q);
    if (Array.isArray(r) && r.length) return r;
    const id = load()?.user?.id;
    if (!id) return r;
    await api("inkwell_profiles?on_conflict=user_id,profile", { method: "POST", prefer: "resolution=ignore-duplicates,return=minimal",
      body: { user_id: id, profile: "principal", schema: 2, data: { _schema: 2, collection: {}, decks: [], wishlist: {} } } });
    return api(q);
  }

  return {
    api, collections,
    user: () => { sess = load(); return sess ? { id: sess.user?.id, email: sess.user?.email } : null; },
    status: () => { sess = load(); return sess ? { signedIn: true, email: sess.user?.email || "" } : { signedIn: false }; },
    async requestCode(email) {
      const redirect = cfg.redirect || location.href.split("#")[0];
      // where to come back after the confirmation page (/entrar/), same site only
      try { localStorage.setItem("inkwell-return", JSON.stringify({ path: location.pathname + location.search, at: Date.now() })); } catch { /* private mode */ }
      const r = await fetch(`${cfg.url}/auth/v1/otp?redirect_to=${encodeURIComponent(redirect)}`, { method: "POST", headers: headers(), body: JSON.stringify({ email, create_user: true }) });
      if (!r.ok) throw Object.assign(new Error(`otp ${r.status}`), { status: r.status });
    },
    async verify(email, code) {
      const r = await fetch(`${cfg.url}/auth/v1/verify`, { method: "POST", headers: headers(), body: JSON.stringify({ type: "email", email, token: String(code).replace(/\s/g, "") }) });
      if (!r.ok) throw Object.assign(new Error(`verify ${r.status}`), { status: r.status });
      store(session(await r.json()));
    },
    // The e-mail's own link to /entrar/?h=<token hash>: signs in only when the person presses the button there,
    // so a mail scanner that just opens the link doesn't use it up.
    async verifyHash(tokenHash, type = "email") {
      const r = await fetch(`${cfg.url}/auth/v1/verify`, { method: "POST", headers: headers(), body: JSON.stringify({ type, token_hash: String(tokenHash) }) });
      if (!r.ok) throw Object.assign(new Error(`verify ${r.status}`), { status: r.status });
      store(session(await r.json()));
    },
    signOut() {
      const old = sess; store(null);
      if (old) fetch(`${cfg.url}/auth/v1/logout`, { method: "POST", headers: headers(old.access_token) }).catch(() => {});
    },
    async send(logs) {
      const tok = await token();   // also reloads sess
      if (!tok) return false;
      const rows = logs.map((l) => ({ user_id: sess.user.id, game_id: l.game_id, source: l.source, played_at: l.played_at, log: l }));
      const r = await fetch(`${cfg.url}/rest/v1/game_logs?on_conflict=user_id,game_id`, {
        method: "POST", headers: { ...headers(tok), Prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify(rows) });
      if (r.status === 401) store({ ...sess, expires_at: 0 });   // force a refresh on the next try
      return r.ok;
    },
  };
})();
