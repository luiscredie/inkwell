-- Community: display names, and the index for the feed of public games.
-- Run after coach_review.sql (safe to run again).
create table if not exists public.profiles (
  user_id uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  display_name text not null check (length(btrim(display_name)) between 2 and 40),
  updated_at timestamptz not null default now()
);
alter table public.profiles enable row level security;
drop policy if exists "signed-in users read names" on public.profiles;
create policy "signed-in users read names" on public.profiles for select to authenticated using (true);
drop policy if exists "players add their name" on public.profiles;
create policy "players add their name" on public.profiles for insert to authenticated with check ((select auth.uid()) = user_id);
drop policy if exists "players change their name" on public.profiles;
create policy "players change their name" on public.profiles for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
grant select, insert, update on public.profiles to authenticated;

create index if not exists game_logs_public_played on public.game_logs (played_at desc) where visibility = 'public';
