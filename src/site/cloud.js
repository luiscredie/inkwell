/* Inkwell Lore Counter: cloud adapter for the offline app.
 *
 * Talks to the Inkwell Supabase project with plain fetch (no library to cache):
 *   sign-in   email one-time code (or the magic link, when opened in the same browser)
 *   storage   public.game_logs, one row per game, upserted on (user_id, game_id),
 *             so a retry after a dropped connection never creates a duplicate
 * The counter keeps every match locally until send() resolves true.
 * Only the public URL and publishable key are here; row-level security limits each user to their own rows.
 */
// Feature flags. The guest experience (Começar meu Inkwell, new Início) is on for everyone since 26/10/2026.
// ?preview=off shows the previous experience in this tab (sessionStorage); ?preview=visitante turns it back on.
// Rollback: set GUEST_DEFAULT to false (nothing in the database changes).
window.INKWELL_FLAGS = (() => {
  const GUEST_DEFAULT = true;
  const f = { guestProfile: GUEST_DEFAULT };
  try {
    const q = new URLSearchParams(location.search).get("preview");
    if (q === "visitante") sessionStorage.setItem("inkwell-preview", "visitante");
    if (q === "off") sessionStorage.setItem("inkwell-preview", "off");
    const v = sessionStorage.getItem("inkwell-preview");
    if (v === "visitante") f.guestProfile = true;
    if (v === "off") f.guestProfile = false;
  } catch { /* storage off: the default stays */ }
  return f;
})();
// MYP Cards prices (data/prices-br.json): off since 01/11/2026 — the store blocks automated access, so they can't be
// kept up to date; prices are TCGplayer only. Turn back on with true once there is an allowed way to refresh them.
if (window.INKWELL_PRICES_BR === undefined) window.INKWELL_PRICES_BR = false;
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

  // One refresh at a time. A page fires ~15 calls at once when it opens; with an expired token (a phone waking up
  // after an hour) each one used to refresh on its own with the same refresh token — 16 refreshes in one second,
  // Supabase answering 500 to some, and a page that could end up signed out. Now the calls of this page share one
  // refresh, and pages of other tabs wait their turn (Web Locks) and pick up the tokens the first one saved.
  let refreshing = null;
  async function token() {
    sess = load();   // another page (or the Inkwell app) may have signed in, out, or refreshed the tokens meanwhile
    if (!sess) return null;
    if (sess.expires_at - 60 > Date.now() / 1000) return sess.access_token;
    if (!refreshing) {
      const run = () => refresh();
      refreshing = (navigator.locks?.request ? navigator.locks.request("inkwell-auth-refresh", run) : run())
        .finally(() => { refreshing = null; });
    }
    return refreshing;
  }
  // a 401: refresh on the next call — unless that token was already replaced (a call that left before a refresh)
  function expire(tok) { const now = load(); if (now && now.access_token === tok) store({ ...now, expires_at: 0 }); }
  async function refresh() {
    sess = load();   // inside the lock: another tab may have just refreshed
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

  // Supabase Auth endpoints used by the passkeys (same requests supabase-js makes)
  async function auth(path, { method = "POST", body, tok } = {}) {
    const r = await fetch(`${cfg.url}/auth/v1/${path}`, { method, headers: { ...headers(tok), "X-Supabase-Api-Version": "2024-01-01" }, body: body === undefined ? undefined : JSON.stringify(body) });
    let j = null; try { j = r.status === 204 ? null : await r.json(); } catch { /* no body */ }
    if (!r.ok) throw Object.assign(new Error(`auth ${path} ${r.status}`), { status: r.status, why: String(j?.msg || j?.message || j?.error_description || "").slice(0, 200), code: j?.error_code || j?.code });
    return j;
  }
  const b64u = { dec: (s) => Uint8Array.from(atob(String(s).replace(/-/g, "+").replace(/_/g, "/") + "===".slice((String(s).length + 3) % 4)), (c) => c.charCodeAt(0)).buffer,
    enc: (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "") };
  const ids = (list) => (list || []).map((c) => ({ ...c, id: b64u.dec(c.id), type: c.type || "public-key" }));
  const pkRequest = (o) => (typeof PublicKeyCredential.parseRequestOptionsFromJSON === "function" ? PublicKeyCredential.parseRequestOptionsFromJSON(o)
    : { ...o, challenge: b64u.dec(o.challenge), ...(o.allowCredentials?.length ? { allowCredentials: ids(o.allowCredentials) } : {}) });
  const pkCreate = (o) => (typeof PublicKeyCredential.parseCreationOptionsFromJSON === "function" ? PublicKeyCredential.parseCreationOptionsFromJSON(o)
    : { ...o, challenge: b64u.dec(o.challenge), user: { ...o.user, id: b64u.dec(o.user.id) }, ...(o.excludeCredentials?.length ? { excludeCredentials: ids(o.excludeCredentials) } : {}) });
  function pkJSON(c) {   // the credential as JSON (WebAuthn level 3 toJSON, or by hand for older browsers)
    if (typeof c.toJSON === "function") return c.toJSON();
    const r = c.response, out = { id: c.id, rawId: c.id, type: "public-key", clientExtensionResults: c.getClientExtensionResults?.() || {}, authenticatorAttachment: c.authenticatorAttachment || undefined, response: { clientDataJSON: b64u.enc(r.clientDataJSON) } };
    if (r.attestationObject) out.response.attestationObject = b64u.enc(r.attestationObject);
    if (r.authenticatorData) Object.assign(out.response, { authenticatorData: b64u.enc(r.authenticatorData), signature: b64u.enc(r.signature), userHandle: r.userHandle ? b64u.enc(r.userHandle) : undefined });
    return out;
  }

  // Authenticated call to the database's REST API (used by Coach Review). Errors carry a short code.
  // anon: true also works signed out (the publishable key), for the few functions open to visitors
  async function api(path, { method = "GET", body, prefer, anon = false, keepalive = false } = {}) {
    const tok = await token();
    if (!tok && !anon) throw Object.assign(new Error("signed out"), { code: "auth" });
    const r = await fetch(`${cfg.url}/rest/v1/${path}`, {
      method, keepalive, headers: { ...headers(tok), ...(prefer ? { Prefer: prefer } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    if (r.status === 401) expire(tok);
    if (!r.ok) {
      const code = r.status === 401 || r.status === 403 ? "permission" : r.status === 400 || r.status === 409 || r.status === 413 ? "invalid_argument" : "unavailable";
      // the database's own reason (e.g. "adults_only", "event_full", "too_many_friend_requests") goes in the message,
      // so a page can tell the person what happened
      let why = ""; try { why = String((await r.json())?.message || "").slice(0, 200); } catch { /* no body */ }
      throw Object.assign(new Error(`${method} ${path.split("?")[0]} ${r.status}${why ? `: ${why}` : ""}`), { code, status: r.status, why });
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

  // Storage (supabase/achievements.sql): upload one file to a private bucket, signed links to see files, remove files.
  async function storage(path, { method = "POST", body, type = "application/json" } = {}) {
    const tok = await token();
    const r = await fetch(`${cfg.url}/storage/v1/${path}`, { method, headers: { ...headers(tok), "Content-Type": type }, body: type === "application/json" && body !== undefined ? JSON.stringify(body) : body });
    if (!r.ok) { let why = ""; try { why = String((await r.json())?.message || "").slice(0, 200); } catch { /* */ } throw Object.assign(new Error(`storage ${r.status}${why ? `: ${why}` : ""}`), { status: r.status, why }); }
    const t = await r.text(); return t ? JSON.parse(t) : null;
  }
  const upload = (bucket, name, blob) => storage(`object/${bucket}/${name.split("/").map(encodeURIComponent).join("/")}`, { body: blob, type: blob.type || "application/octet-stream" });
  async function signed(bucket, names, seconds = 3600) {
    if (!names.length) return {};
    const r = await storage(`object/sign/${bucket}`, { body: { expiresIn: seconds, paths: names } }).catch(() => []);
    const out = {}; for (const x of r || []) if (x?.signedURL && !x.error) out[x.path] = `${cfg.url}/storage/v1${x.signedURL}`; return out;
  }
  const removeFiles = (bucket, names) => (names.length ? storage(`object/${bucket}`, { method: "DELETE", body: { prefixes: names } }) : Promise.resolve(null));

  // an Edge Function by GET (signed in or not: the publishable key is enough for public ones)
  async function fn(name, params = {}) {
    const tok = sess ? await token().catch(() => null) : null;
    const r = await fetch(`${cfg.url}/functions/v1/${name}?${new URLSearchParams(params)}`, { headers: headers(tok) });
    if (!r.ok) throw Object.assign(new Error(`${name} ${r.status}`), { status: r.status });
    return r.json();
  }

  return {
    api, collections, fn, upload, signed, removeFiles,
    user: () => { sess = load(); return sess ? { id: sess.user?.id, email: sess.user?.email } : null; },
    status: () => { sess = load(); return sess ? { signedIn: true, email: sess.user?.email || "" } : { signedIn: false }; },
    async requestCode(email) {
      const redirect = cfg.redirect ? new URL(cfg.redirect, location.href).href : location.href.split("#")[0];
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
    // ---------- passkeys (Face ID / digital / chave do aparelho) — Supabase Auth, experimental (Authentication → Passkeys;
    // relying party inkwell.com.br). The e-mail code stays: a passkey is created only after signing in with it once.
    passkeySupported: () => typeof window.PublicKeyCredential === "function" && !!navigator.credentials?.get && (location.protocol === "https:" || location.hostname === "localhost"),
    async passkeySignIn() {
      const o = await auth("passkeys/authentication/options", { body: {} });
      const cred = await navigator.credentials.get({ publicKey: pkRequest(o.options || o) });
      if (!cred) throw Object.assign(new Error("passkey cancelled"), { code: "cancelled" });
      const r = await auth("passkeys/authentication/verify", { body: { challenge_id: o.challenge_id, credential: pkJSON(cred) } });
      const s = r?.access_token ? r : r?.session;
      if (!s?.access_token) throw new Error("passkey: no session");
      store(session(s));
    },
    async passkeyRegister() {
      const tok = await token(); if (!tok) throw Object.assign(new Error("signed out"), { code: "auth" });
      const o = await auth("passkeys/registration/options", { body: {}, tok });
      const cred = await navigator.credentials.create({ publicKey: pkCreate(o.options || o) });
      if (!cred) throw Object.assign(new Error("passkey cancelled"), { code: "cancelled" });
      return auth("passkeys/registration/verify", { body: { challenge_id: o.challenge_id, credential: pkJSON(cred) }, tok });
    },
    async passkeys() { const tok = await token(); return tok ? auth("passkeys", { method: "GET", tok }) : []; },
    async passkeyDelete(id) { const tok = await token(); if (tok) await auth(`passkeys/${encodeURIComponent(id)}`, { method: "DELETE", tok }); },
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
      if (r.status === 401) expire(tok);   // force a refresh on the next try
      return r.ok;
    },
  };
})();
