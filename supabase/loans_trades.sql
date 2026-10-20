-- Loans and trades of cards, private to each player. Items: [{card_id, qty, foil}].
-- Run after game_logs.sql (safe to run again).
create schema if not exists private;
create or replace function private.valid_items(p jsonb) returns boolean language sql immutable set search_path = '' as $$
  select jsonb_typeof(p) = 'array' and jsonb_array_length(p) <= 200 and not exists (
    select 1 from jsonb_array_elements(p) e
    where jsonb_typeof(e) <> 'object' or coalesce(e->>'card_id', '') = '' or length(e->>'card_id') > 40
       or jsonb_typeof(e->'qty') <> 'number' or (e->>'qty')::numeric not between 1 and 99);
$$;
grant usage on schema private to authenticated;
grant execute on function private.valid_items(jsonb) to authenticated;

create table if not exists public.loans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  direction text not null check (direction in ('lent', 'borrowed')),
  person text not null check (length(btrim(person)) between 1 and 60),
  items jsonb not null check (private.valid_items(items) and jsonb_array_length(items) > 0),
  lent_on date not null default current_date,
  due_on date,
  returned_at timestamptz,
  note text not null default '' check (length(note) <= 500),
  created_at timestamptz not null default now()
);
create index if not exists loans_user_open on public.loans (user_id, returned_at);

create table if not exists public.trades (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  person text not null check (length(btrim(person)) between 1 and 60),
  traded_on date not null default current_date,
  gave jsonb not null default '[]' check (private.valid_items(gave)),
  got jsonb not null default '[]' check (private.valid_items(got)),
  cash_brl numeric(10, 2) not null default 0 check (cash_brl between -100000 and 100000),
  note text not null default '' check (length(note) <= 500),
  created_at timestamptz not null default now(),
  check (jsonb_array_length(gave) + jsonb_array_length(got) > 0)
);
create index if not exists trades_user_on on public.trades (user_id, traded_on desc);

alter table public.loans enable row level security;
alter table public.trades enable row level security;
drop policy if exists "owners manage loans" on public.loans;
create policy "owners manage loans" on public.loans for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
drop policy if exists "owners manage trades" on public.trades;
create policy "owners manage trades" on public.trades for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
grant select, insert, update, delete on public.loans, public.trades to authenticated;
