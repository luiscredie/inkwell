-- Coach Review: who can see a game, comments on games, coach access.
-- Run after game_logs.sql, once, in Supabase Dashboard > SQL Editor (safe to run again).
--
-- Who sees what:
--   private game  the player, and coaches the player added by email
--   public game   anyone signed in
--   comments      whoever can see the game can read them and add their own;
--                 the author or the game's player can delete one

-- 1. Visibility on each game
alter table public.game_logs
  add column if not exists visibility text not null default 'private';
do $$ begin
  alter table public.game_logs add constraint game_logs_visibility_check check (visibility in ('private', 'public'));
exception when duplicate_object then null; end $$;

-- 2. Coaches a player has given access to (by the coach's sign-in email)
create table if not exists public.coach_links (
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  owner_email text not null default lower(coalesce(auth.jwt() ->> 'email', '')),
  coach_email text not null check (coach_email = lower(coach_email) and coach_email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  created_at timestamptz not null default now(),
  primary key (owner_id, coach_email)
);
alter table public.coach_links enable row level security;

drop policy if exists "players manage their coaches" on public.coach_links;
create policy "players manage their coaches" on public.coach_links for all to authenticated
  using ((select auth.uid()) = owner_id) with check ((select auth.uid()) = owner_id);
drop policy if exists "coaches see who shared with them" on public.coach_links;
create policy "coaches see who shared with them" on public.coach_links for select to authenticated
  using (coach_email = lower((select auth.jwt() ->> 'email')));

grant select, insert, update, delete on public.coach_links to authenticated;

-- 3. One check used by the comment rules (security definer so it can look at games and links)
create or replace function public.can_read_game(p_owner uuid, p_game text) returns boolean
language sql stable security definer set search_path = '' as $$
  select p_owner = (select auth.uid())
      or exists (select 1 from public.game_logs g where g.user_id = p_owner and g.game_id = p_game and g.visibility = 'public')
      or exists (select 1 from public.coach_links c where c.owner_id = p_owner and c.coach_email = lower((select auth.jwt() ->> 'email')));
$$;
revoke all on function public.can_read_game(uuid, text) from public, anon;
grant execute on function public.can_read_game(uuid, text) to authenticated;

-- 4. Games: the player, coaches the player added, and everyone for public games
drop policy if exists "owners read game logs" on public.game_logs;
drop policy if exists "readers see game logs" on public.game_logs;
create policy "readers see game logs" on public.game_logs for select to authenticated
  using (
    (select auth.uid()) = user_id
    or visibility = 'public'
    or exists (select 1 from public.coach_links c where c.owner_id = game_logs.user_id and c.coach_email = lower((select auth.jwt() ->> 'email')))
  );

-- 5. Comments
create table if not exists public.game_notes (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null,
  game_id text not null,
  author uuid not null default auth.uid() references auth.users(id) on delete cascade,
  author_name text not null default '' check (length(author_name) <= 60),
  anchor jsonb not null check (jsonb_typeof(anchor) = 'object' and pg_column_size(anchor) < 2048),
  body text not null check (length(body) between 1 and 4000),
  created_at timestamptz not null default now(),
  foreign key (owner_id, game_id) references public.game_logs(user_id, game_id) on delete cascade
);
create index if not exists game_notes_game on public.game_notes (owner_id, game_id, created_at);
alter table public.game_notes enable row level security;

drop policy if exists "readers see comments" on public.game_notes;
create policy "readers see comments" on public.game_notes for select to authenticated
  using ((select public.can_read_game(owner_id, game_id)));
drop policy if exists "readers add their own comments" on public.game_notes;
create policy "readers add their own comments" on public.game_notes for insert to authenticated
  with check (author = (select auth.uid()) and (select public.can_read_game(owner_id, game_id)));
drop policy if exists "author or player deletes comments" on public.game_notes;
create policy "author or player deletes comments" on public.game_notes for delete to authenticated
  using (author = (select auth.uid()) or owner_id = (select auth.uid()));

grant select, insert, delete on public.game_notes to authenticated;
