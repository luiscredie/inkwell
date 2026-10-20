-- Loans between two players who are both on the site (and friends).
-- Flow: one asks (requested) -> the other accepts (accepted) or declines ->
-- either marks the physical delivery with a date (delivered) -> either marks the return with a date (returned).
-- The one who asked can cancel before acceptance; either can cancel before delivery.
-- Run after loans_trades.sql and friends.sql (safe to run again).

create table if not exists public.user_loans (
  id uuid primary key default gen_random_uuid(),
  lender uuid not null references auth.users(id) on delete cascade,
  borrower uuid not null references auth.users(id) on delete cascade,
  created_by uuid not null default auth.uid() references auth.users(id) on delete cascade,
  items jsonb not null check (private.valid_items(items) and jsonb_array_length(items) > 0),
  due_on date,
  note text not null default '' check (length(note) <= 500),
  status text not null default 'requested'
    check (status in ('requested', 'accepted', 'declined', 'cancelled', 'delivered', 'returned')),
  accepted_at timestamptz,
  delivered_on date, delivered_by uuid references auth.users(id) on delete set null,
  returned_on date, returned_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (lender <> borrower),
  check (created_by in (lender, borrower)),
  check (returned_on is null or delivered_on is null or returned_on >= delivered_on)
);
create index if not exists user_loans_lender on public.user_loans (lender, status);
create index if not exists user_loans_borrower on public.user_loans (borrower, status);

alter table public.user_loans enable row level security;
drop policy if exists "both people see the loan" on public.user_loans;
create policy "both people see the loan" on public.user_loans for select to authenticated
  using ((select auth.uid()) in (lender, borrower));
drop policy if exists "friends ask for a loan" on public.user_loans;
create policy "friends ask for a loan" on public.user_loans for insert to authenticated
  with check (created_by = (select auth.uid()) and (select auth.uid()) in (lender, borrower)
              and status = 'requested' and (select private.are_friends(lender, borrower)));
drop policy if exists "both people move the loan along" on public.user_loans;
create policy "both people move the loan along" on public.user_loans for update to authenticated
  using ((select auth.uid()) in (lender, borrower)) with check ((select auth.uid()) in (lender, borrower));
drop policy if exists "asker deletes an unanswered request" on public.user_loans;
create policy "asker deletes an unanswered request" on public.user_loans for delete to authenticated
  using (created_by = (select auth.uid()) and status in ('requested', 'declined', 'cancelled'));
grant select, insert, update, delete on public.user_loans to authenticated;

-- Only the allowed steps; who did what and when is stamped here, not trusted from the client.
create or replace function private.user_loans_step() returns trigger
language plpgsql security definer set search_path = '' as $$
declare me uuid := auth.uid(); d_on date := new.delivered_on; r_on date := new.returned_on;
begin
  if me is null then return new; end if;   -- dashboard / service maintenance
  if new.lender <> old.lender or new.borrower <> old.borrower or new.created_by <> old.created_by then
    raise exception 'loan parties cannot change';
  end if;
  -- stamps come from here, never from the client
  new.created_at := old.created_at; new.accepted_at := old.accepted_at;
  new.delivered_on := old.delivered_on; new.delivered_by := old.delivered_by;
  new.returned_on := old.returned_on; new.returned_by := old.returned_by;
  if new.status = old.status then
    -- the asker may still edit cards, due date and note before the other person answers
    if old.status <> 'requested' or me <> old.created_by then raise exception 'nothing to change at this step'; end if;
  else
    new.items := old.items;
    if old.status = 'requested' and new.status in ('accepted', 'declined') then
      if me = old.created_by then raise exception 'the other person answers the request'; end if;
      if new.status = 'accepted' then new.accepted_at := now(); end if;
    elsif old.status = 'requested' and new.status = 'cancelled' then
      if me <> old.created_by then raise exception 'only who asked can cancel the request'; end if;
    elsif old.status = 'accepted' and new.status = 'cancelled' then
      null;
    elsif old.status = 'accepted' and new.status = 'delivered' then
      new.delivered_on := coalesce(d_on, current_date); new.delivered_by := me;
      if new.delivered_on > current_date + 1 then raise exception 'delivery date is in the future'; end if;
    elsif old.status = 'delivered' and new.status = 'returned' then
      new.returned_on := coalesce(r_on, current_date); new.returned_by := me;
      if new.returned_on > current_date + 1 then raise exception 'return date is in the future'; end if;
      if new.returned_on < new.delivered_on then raise exception 'return date is before the delivery'; end if;
    else
      raise exception 'a loan cannot go from % to %', old.status, new.status;
    end if;
  end if;
  new.updated_at := now();
  return new;
end $$;
revoke all on function private.user_loans_step() from public, anon, authenticated;
drop trigger if exists user_loans_step on public.user_loans;
create trigger user_loans_step before update on public.user_loans
  for each row execute function private.user_loans_step();

-- New rows start clean whatever the client sends.
create or replace function private.user_loans_new() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  new.status := 'requested'; new.accepted_at := null;
  new.delivered_on := null; new.delivered_by := null; new.returned_on := null; new.returned_by := null;
  new.created_at := now(); new.updated_at := now();
  return new;
end $$;
revoke all on function private.user_loans_new() from public, anon, authenticated;
drop trigger if exists user_loans_new on public.user_loans;
create trigger user_loans_new before insert on public.user_loans
  for each row execute function private.user_loans_new();
