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

## Loans and trades (`/trades/`)

Run `supabase/loans_trades.sql`. The page records cards lent and borrowed (with
due dates and returns) and trades (what was given and received, plus any money),
valued at the site's Liga Lorcana prices. It reads the collection from
`inkwell_profiles` to show how many copies are free after loans; it doesn't
change the collection. Add `https://luiscredie.github.io/inkwell/trades/` to the
Redirect URLs (or use `https://luiscredie.github.io/inkwell/**`).

## Home feed and friends (`/feed/`)

Run `supabase/friends.sql`. Players find each other by display name, ask and
accept friendships, and choose who sees their new games (only me, friends,
everyone), optionally applying it to older games. The feed shows the player's
and their friends' shared games, newest first, with comments. Friends never see
opponents' names. Add `https://luiscredie.github.io/inkwell/feed/` to the
Redirect URLs (or `https://luiscredie.github.io/inkwell/**`).

## Who sees a game: coaches, friend groups and coach groups

Run `supabase/audiences.sql`, then `supabase/coach_choice.sql` (both already
applied to the project). Each game has one audience: only me, all my coaches,
one coach, a coach group, friends, a friend group, or everyone. Players set the
default for new games and manage friend groups and coach groups on `/feed/`,
and change one game in Coach Review ("Who can see this game"). Coaches see only
games shared with them (or with everyone); a game shared with friends does not
reach a coach who isn't a friend.

## Loans: only cards you have free

On `/trades/`, "I lent" and "I gave" search only your Inkwell collection, show
how many copies you have, how many are lent out, and let you pick only the free
ones (normal and foil counted apart).

## Loans between friends on the site

Run `supabase/user_loans.sql` (already applied). On `/trades/`, "New loan" →
"A friend on the site": one friend asks (to lend or to borrow), the other
accepts or declines, then either marks the physical delivery with a date and
later the return with a date. Steps are enforced in the database; cards promised
in an accepted loan stop counting as free in the lender's collection.

## Trades between friends, collection updates and the public board

Run `supabase/user_trades_listings.sql` (already applied).
- Trades with a friend on the site: proposal → accept / decline → done (with the
  date the cards changed hands), enforced by a trigger.
- After any finished trade (with a friend or someone off the site) each player is
  asked whether to update their Inkwell collection; "always update" is saved in
  `profiles.auto_collection`. Updates go through `apply_collection_delta`, which
  bumps the profile revision so Inkwell pulls the change on its next sync.
- Public board (`listings`): what each player wants to borrow / buy and what they
  lend / sell; every signed-in player sees it.

## Sign-in e-mails (code + safe link)

The site's sign-in field takes the whole code (6 to 10 digits, whatever "Email OTP Length" says) and never cuts it.
Outlook/Hotmail open e-mail links by themselves to scan them, which uses up Supabase's own link (`{{ .ConfirmationURL }}`)
and, with it, the code from the same e-mail. To fix that, in **Authentication → Emails**, give both **Magic Link** and
**Confirm signup** this body (from a computer; the dashboard editor may not take a paste on a phone):

```html
<h2>Entrar no Inkwell</h2>
<p>Seu código: <b>{{ .Token }}</b></p>
<p><a href="https://luiscredie.github.io/inkwell/entrar/?h={{ .TokenHash }}">Ou toque aqui para entrar</a></p>
```

`/entrar/` signs in only when the person presses its button, so a scanner that opens the link uses nothing.
Until the templates change, the site still works with the code; a link already used by a scanner brings the person
back with an explanation and the sign-in sheet open.
