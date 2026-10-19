-- Inkwell game logs: one row per game (Lore Counter now; duels.ink imports, Training Logger and video later).
-- Run once in Supabase Dashboard > SQL Editor (safe to run again).
-- Format of `log`: game-log 1.0 (inkwell-2/packages/gamelog/game-log.schema.json).

create table if not exists public.game_logs (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  game_id text not null check (length(game_id) between 1 and 120),
  source text not null check (source in ('lore_counter', 'tap_logger', 'video', 'duels_ink', 'manual')),
  played_at timestamptz,
  log jsonb not null check (jsonb_typeof(log) = 'object' and pg_column_size(log) < 262144),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, game_id)
);

create index if not exists game_logs_user_played on public.game_logs (user_id, played_at desc);

alter table public.game_logs enable row level security;

drop policy if exists "owners read game logs" on public.game_logs;
create policy "owners read game logs" on public.game_logs for select
  to authenticated using ((select auth.uid()) = user_id);

drop policy if exists "owners add game logs" on public.game_logs;
create policy "owners add game logs" on public.game_logs for insert
  to authenticated with check ((select auth.uid()) = user_id);

-- Needed for upsert: a resend after a dropped connection updates the same row instead of failing.
drop policy if exists "owners update game logs" on public.game_logs;
create policy "owners update game logs" on public.game_logs for update
  to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

drop policy if exists "owners delete game logs" on public.game_logs;
create policy "owners delete game logs" on public.game_logs for delete
  to authenticated using ((select auth.uid()) = user_id);

create or replace function public.game_logs_touch() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists game_logs_touch on public.game_logs;
create trigger game_logs_touch before update on public.game_logs
  for each row execute function public.game_logs_touch();

revoke all on public.game_logs from anon;
grant select, insert, update, delete on public.game_logs to authenticated;
