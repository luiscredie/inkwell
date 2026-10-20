-- Trades between friends on the site, collection updates after a trade, and the public board
-- (what players want to borrow / buy and what they lend / sell).
-- Run after user_loans.sql and inkwell_profiles.sql (safe to run again).

-- ---------- trades between friends ----------
-- proposer gives `gave`, partner gives `got`; cash_brl > 0 means the proposer pays the partner.
-- Flow: proposed -> accepted | declined | cancelled -> completed (with the date the cards changed hands).
-- After completion each side decides whether to apply it to their own collection (applied / skipped).
create table if not exists public.user_trades (
  id uuid primary key default gen_random_uuid(),
  proposer uuid not null default auth.uid() references auth.users(id) on delete cascade,
  partner uuid not null references auth.users(id) on delete cascade,
  gave jsonb not null default '[]' check (private.valid_items(gave)),
  got jsonb not null default '[]' check (private.valid_items(got)),
  cash_brl numeric(10, 2) not null default 0 check (cash_brl between -100000 and 100000),
  note text not null default '' check (length(note) <= 500),
  status text not null default 'proposed' check (status in ('proposed', 'accepted', 'declined', 'cancelled', 'completed')),
  accepted_at timestamptz,
  completed_on date, completed_by uuid references auth.users(id) on delete set null,
  proposer_collection text check (proposer_collection in ('applied', 'skipped')),
  partner_collection text check (partner_collection in ('applied', 'skipped')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (proposer <> partner),
  check (jsonb_array_length(gave) + jsonb_array_length(got) > 0)
);
create index if not exists user_trades_proposer on public.user_trades (proposer, status);
create index if not exists user_trades_partner on public.user_trades (partner, status);
alter table public.user_trades enable row level security;
drop policy if exists "both people see the trade" on public.user_trades;
create policy "both people see the trade" on public.user_trades for select to authenticated
  using ((select auth.uid()) in (proposer, partner));
drop policy if exists "friends propose a trade" on public.user_trades;
create policy "friends propose a trade" on public.user_trades for insert to authenticated
  with check (proposer = (select auth.uid()) and (select private.are_friends(proposer, partner)));
drop policy if exists "both people move the trade along" on public.user_trades;
create policy "both people move the trade along" on public.user_trades for update to authenticated
  using ((select auth.uid()) in (proposer, partner)) with check ((select auth.uid()) in (proposer, partner));
drop policy if exists "proposer deletes an unanswered trade" on public.user_trades;
create policy "proposer deletes an unanswered trade" on public.user_trades for delete to authenticated
  using (proposer = (select auth.uid()) and status in ('proposed', 'declined', 'cancelled'));
grant select, insert, update, delete on public.user_trades to authenticated;

create or replace function private.user_trades_new() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  new.status := 'proposed'; new.accepted_at := null; new.completed_on := null; new.completed_by := null;
  new.proposer_collection := null; new.partner_collection := null;
  new.created_at := now(); new.updated_at := now();
  return new;
end $$;
revoke all on function private.user_trades_new() from public, anon, authenticated;
drop trigger if exists user_trades_new on public.user_trades;
create trigger user_trades_new before insert on public.user_trades for each row execute function private.user_trades_new();

create or replace function private.user_trades_step() returns trigger
language plpgsql security definer set search_path = '' as $$
declare me uuid := auth.uid(); c_on date := new.completed_on; pc text := new.proposer_collection; tc text := new.partner_collection;
begin
  if me is null then return new; end if;
  if new.proposer <> old.proposer or new.partner <> old.partner then raise exception 'trade parties cannot change'; end if;
  new.created_at := old.created_at; new.accepted_at := old.accepted_at;
  new.completed_on := old.completed_on; new.completed_by := old.completed_by;
  new.proposer_collection := old.proposer_collection; new.partner_collection := old.partner_collection;
  if new.status = old.status then
    if old.status = 'proposed' and me = old.proposer then
      null;   -- the proposer may still edit cards, money and note
    elsif old.status = 'completed' then
      -- each side records its own collection decision, once
      new.gave := old.gave; new.got := old.got; new.cash_brl := old.cash_brl; new.note := old.note;
      if me = old.proposer and old.proposer_collection is null then new.proposer_collection := pc; end if;
      if me = old.partner and old.partner_collection is null then new.partner_collection := tc; end if;
    else
      raise exception 'nothing to change at this step';
    end if;
  else
    new.gave := old.gave; new.got := old.got; new.cash_brl := old.cash_brl;
    if old.status = 'proposed' and new.status in ('accepted', 'declined') then
      if me <> old.partner then raise exception 'the other person answers the proposal'; end if;
      if new.status = 'accepted' then new.accepted_at := now(); end if;
    elsif old.status = 'proposed' and new.status = 'cancelled' then
      if me <> old.proposer then raise exception 'only who proposed can cancel the proposal'; end if;
    elsif old.status = 'accepted' and new.status = 'cancelled' then
      null;
    elsif old.status = 'accepted' and new.status = 'completed' then
      new.completed_on := coalesce(c_on, current_date); new.completed_by := me;
      if new.completed_on > current_date + 1 then raise exception 'trade date is in the future'; end if;
    else
      raise exception 'a trade cannot go from % to %', old.status, new.status;
    end if;
  end if;
  new.updated_at := now();
  return new;
end $$;
revoke all on function private.user_trades_step() from public, anon, authenticated;
drop trigger if exists user_trades_step on public.user_trades;
create trigger user_trades_step before update on public.user_trades for each row execute function private.user_trades_step();

-- Trades recorded with people outside the site can also be applied to the collection.
alter table public.trades add column if not exists collection text check (collection in ('applied', 'skipped'));
update public.trades set collection = 'skipped' where collection is null and created_at < now();

-- Each player's choice: apply finished trades to the collection without asking.
alter table public.profiles add column if not exists auto_collection boolean not null default false;

-- ---------- collection changes ----------
-- Adds and removes copies in one Inkwell profile's collection: p_delta = [{card_id, qty (signed), foil}].
-- Never goes below zero. Bumps the revision, so Inkwell on other devices pulls the change
-- (or keeps a conflict snapshot if it had unsynced edits).
create or replace function public.apply_collection_delta(p_profile text, p_delta jsonb)
returns void language plpgsql security invoker set search_path = '' as $$
declare d jsonb; e jsonb; cur jsonb; k text;
begin
  if auth.uid() is null then raise exception 'authentication_required' using errcode = '42501'; end if;
  if jsonb_typeof(p_delta) <> 'array' or jsonb_array_length(p_delta) > 400 then raise exception 'bad delta'; end if;
  select data into d from public.inkwell_profiles where user_id = auth.uid() and profile = p_profile for update;
  if d is null then raise exception 'profile not found'; end if;
  d := jsonb_set(d, '{collection}', coalesce(d->'collection', '{}'::jsonb));
  for e in select * from jsonb_array_elements(p_delta) loop
    if coalesce(e->>'card_id', '') = '' or length(e->>'card_id') > 40 or jsonb_typeof(e->'qty') <> 'number' then raise exception 'bad delta item'; end if;
    k := case when coalesce((e->>'foil')::boolean, false) then 'f' else 'n' end;
    cur := coalesce(d->'collection'->(e->>'card_id'), '{"n": 0, "f": 0}'::jsonb);
    cur := jsonb_set(cur, array[k], to_jsonb(greatest(0, coalesce((cur->>k)::int, 0) + (e->>'qty')::int)));
    d := jsonb_set(d, array['collection', e->>'card_id'], cur);
  end loop;
  update public.inkwell_profiles set data = d, revision = revision + 1, updated_at = now()
   where user_id = auth.uid() and profile = p_profile;
end $$;
revoke all on function public.apply_collection_delta(text, jsonb) from public, anon;
grant execute on function public.apply_collection_delta(text, jsonb) to authenticated;

-- ---------- public board ----------
-- borrow / buy = I'm looking for this card; lend / sell = I offer it. Every signed-in player sees the board.
create table if not exists public.listings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  kind text not null check (kind in ('borrow', 'buy', 'lend', 'sell')),
  card_id text not null check (length(card_id) between 1 and 40),
  qty integer not null default 1 check (qty between 1 and 99),
  foil boolean not null default false,
  price_brl numeric(10, 2) check (price_brl is null or price_brl between 0 and 100000),
  note text not null default '' check (length(note) <= 200),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists listings_card on public.listings (card_id, kind);
create index if not exists listings_user on public.listings (user_id);
alter table public.listings enable row level security;
drop policy if exists "signed-in players see the board" on public.listings;
create policy "signed-in players see the board" on public.listings for select to authenticated using (true);
drop policy if exists "players manage their listings" on public.listings;
create policy "players manage their listings" on public.listings for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
grant select, insert, update, delete on public.listings to authenticated;
