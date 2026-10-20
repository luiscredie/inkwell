# Inkwell cloud sync setup

The browser app already uses Supabase magic-link authentication. The database
objects and Row Level Security policies are installed separately.

1. Open the Inkwell Supabase project.
2. Open **SQL Editor**, create a new query, and run
   `supabase/inkwell_profiles.sql`.
3. In **Authentication → URL Configuration**, add the production GitHub Pages
   URL to **Redirect URLs**.
4. Keep only the public project URL and publishable/anon key in
   `site/sync-config.json`. Never commit a service-role key.
5. Sign in on two browsers with the same email and press **Sync now**.

The SQL enables RLS so an authenticated user can access only their own rows.
Writes use a revision check. If two devices edit the same profile concurrently,
the second write is stopped and Inkwell preserves a local conflict snapshot
instead of silently overwriting the other device.

To verify the table from Supabase SQL Editor:

```sql
select profile, revision, updated_at
from public.inkwell_profiles
where user_id = auth.uid();
```


## Lore Counter (offline app at `/counter/`)

The Lore Counter works with no internet and sends each finished match to
`public.game_logs` when the phone is back online. One-time setup:

1. **SQL Editor**: run `supabase/game_logs.sql` (safe to run again).
2. **Authentication → Emails → Magic Link**: add the code to the email body, e.g.
   `<p>Código: <b>{{ .Token }}</b></p>`. On iPhone an app added to the home
   screen doesn't share Safari's sign-in, so the counter signs in by typing
   this code instead of tapping the link.
3. **Authentication → URL Configuration → Redirect URLs**: add
   `https://luiscredie.github.io/inkwell/counter/`.

The counter is built from the Inkwell 2 repo
(`apps/lorecounter/build_pwa.py --config site/sync-config.json --out site/counter`).
Don't edit `site/counter/` by hand.

## Coach Review (`/coach/`)

Shows your games from `public.game_logs` (the Lore Counter sends them there),
with comments and coach access. One-time setup:

1. **SQL Editor**: run `supabase/coach_review.sql`, then `supabase/game_logs_summary.sql`, after `game_logs.sql`.
2. **Authentication → URL Configuration → Redirect URLs**: add
   `https://luiscredie.github.io/inkwell/coach/` (or `https://luiscredie.github.io/inkwell/**`).
3. A coach signs in with their own email. With Supabase's built-in email
   (no custom SMTP), sign-in emails only go to members of your Supabase
   organization: invite the coach there, or set up custom SMTP (e.g. Resend).

Who sees what (enforced by row-level security): a private game is visible to the
player and to coaches the player added under "My coaches"; a public game to anyone
signed in. Anyone who can see a game can comment; the author or the player can
delete a comment. Only the player can add games or change visibility.

Built from the Inkwell 2 repo (`apps/coach/build_site.py`); don't edit `site/coach/` by hand.

## Automatic duels.ink sync

New duels.ink games arrive in `public.game_logs` every 30 minutes (Edge Function
`duels-sync`, scheduled by pg_cron). Setup is in `supabase/duels_sync.sql`; the
function's code is in the Inkwell 2 repo (`supabase/functions/duels-sync`). The
duels.ink token is the Edge Function secret `DUELS_TOKEN`; Coach Review shows the
last sync and any problem (e.g. an expired token).

## Community feed and display names

Run `supabase/community.sql`. Players choose the name others see on public
games and comments; Coach Review's "Show" menu has "Community: public games",
the newest 300 public games from every player, open to anyone signed in to
read and comment.

## Opponent names in public games

Run `supabase/hide_names.sql`. When a game is made public, the opponent's name
(for example a duels.ink username) is replaced by "Opponent" in the stored game;
the real name is kept in a private table and restored if the game goes back to
private. Coach Review also hides it on screen in the community feed.
