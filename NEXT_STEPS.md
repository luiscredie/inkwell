# Inkwell — Post-deploy instructions

State: M0–M2.1 deployed, CI green, R0.2 closed. Three tasks remain. Do them in
this order — task 1 is the only one that changes what a player experiences.

---

## 1. Activate cloud sync (Supabase)

Sync is live in the shipped app but inert: the app calls a table and an RPC that
do not exist yet. Until this is done, pressing **Sync now** fails.

### 1a. Run the SQL

1. Open the Supabase project `sorefaetiaebmjploanp` (this is the project in
   `site/sync-config.json`).
2. Left sidebar → **SQL Editor** → **New query**.
3. Paste the entire contents of `supabase/inkwell_profiles.sql` and press **Run**.
4. Expect `Success. No rows returned`.

The script is idempotent — safe to run twice. It creates the
`public.inkwell_profiles` table, enables Row Level Security with four
owner-only policies, and creates the `sync_inkwell_profile` compare-and-swap
function.

### 1b. Add the redirect URL

Magic-link sign-in will fail on the live site without this.

1. **Authentication → URL Configuration**.
2. Under **Redirect URLs**, add:

   ```
   https://luiscredie.github.io/inkwell/
   ```

3. Keep `http://localhost:*` if you test locally.
4. Save.

### 1c. Verify the objects exist

New query in the SQL Editor:

```sql
select tablename, rowsecurity
from pg_tables
where schemaname = 'public' and tablename = 'inkwell_profiles';
```

Expect one row with `rowsecurity = true`. If it is `false`, stop — RLS is off and
any signed-in user could read every other user's collection. Re-run the script.

Then confirm the four policies and the function:

```sql
select policyname from pg_policies
where tablename = 'inkwell_profiles';

select proname from pg_proc
where proname = 'sync_inkwell_profile';
```

Expect 4 policy rows and 1 function row.

### 1d. One-shot conflict + RLS check (30 seconds)

Basic sign-in and sync working proves the happy path. It does not touch
`revision_conflict` — the part that stops one device from overwriting another —
or confirm RLS is on. Both are one query. Run this once in the SQL Editor while
signed in as yourself and you can skip the two-browser test entirely.

```sql
-- RLS must be on, or the public anon key exposes every user's collection
select rowsecurity from pg_tables
where schemaname='public' and tablename='inkwell_profiles';

-- simulate a stale second device: write with a revision that is already spent
select revision from public.inkwell_profiles
where user_id = auth.uid() limit 1;

-- substitute the revision you just read MINUS 1 as the last argument
select public.sync_inkwell_profile('default', '{"probe":1}'::jsonb, 1, 0);
```

Pass criteria:

- first query returns `true`. If `false`, stop and re-run the script — any
  signed-in user could otherwise read every other user's collection.
- third query raises **`revision_conflict`**. That error is the success case: it
  means a stale device is refused instead of overwriting. If it returns a row
  instead, the compare-and-swap is not protecting anything and M2.1 needs a fix.

Passing revision `0` against an existing row is exactly what a freshly signed-in
second device sends, so this reproduces the real scenario. Nothing is written when
it raises, so your data is untouched.

Same reason, in the app: if a new device reports a conflict on its *first* sync,
that is correct — it must pull before it can push.

### On the key in `sync-config.json`

`sb_publishable_...` is the publishable/anon key and is meant to be public — it
is safe in the repo. Its safety depends entirely on RLS being on, which is why
1c matters. Never put a `service_role` key in that file.

---

## 2. Repository/public-artifact cleanup — completed

Local backups, captured headers, Python bytecode, test results and historical
recovery directories were removed from tracking. The Pages workflow now builds
a minimal `_site` artifact and excludes raw price caches, pipeline-only reports,
manifests used only by tooling and backup files. `.gitignore` prevents the local
artifacts from returning.

---

## 3. Finish the price refresh

The v5 agent's circuit breaker opened on consecutive 401/403 from LigaLorcana and
correctly refused to publish. Consequence: **the live site shows the previously
validated prices.** `site/data/prices.json` and `price-history.json` are unchanged
and `data-manifest.json` still matches them, so the release is consistent — just
not fresh.

```bash
python tools/ligalorcana_price_agent_daily_v5.py --resume-status
```

Read the output before doing anything else:

- `remaining_today > 0` → the run is incomplete. Resume it.
- any `error` records in the cache → do **not** publish. Those IDs would land as
  nulls or stale values.
- `remaining_today == 0` and no error records → safe to publish derived artifacts.

If the breaker is still tripping on 403, the block is upstream (Cloudflare), not a
bug in the agent. Wait out the window and resume rather than forcing it.

After a clean run, before committing any data change:

```bash
python tools/validate_release.py --root site --quick
npm run test:all
npm run test:py
```

The manifest must be regenerated in the same commit as the data it describes. A
`prices.json` whose sha256 does not match `data-manifest.json` is a broken
release even if the numbers are correct.

---

## After these three

Deployed and verified end to end. The next build is a choice:

**M2.2 — Import Safety & Data Health.** Finishes what M2.1 started:
`import-audit.json` download, an unrecognized-rows report, and the Data Health
surface (plain-language "prices may be stale", diagnostics panel, and never
blocking collection or decks when a price fetch fails). Closes the last
data-loss-adjacent gap. Task 3 above is itself evidence this is needed — you had
to read agent internals to learn the prices were stale; a player cannot.

**M2.3 — Shared Cards & Portfolio UX.** The Shared Card Matrix, plus the reverse
path: click a card inside a deck and see which other decks contest those copies.
V4 already delivered the plan summary and the allocation ledger, so this is the
visible half of your strongest differentiator.

Recommendation: **M2.2**, because task 3 proved the failure is silent to users.
M2.3 is the better demo; M2.2 is the better product right now.
