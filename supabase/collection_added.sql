-- When each card last entered a collection, for the Coleção sort "Mais recentes".
-- The collection itself (inkwell_profiles.data->collection) keeps only counts, and both the
-- Inkwell app (whole-profile saves) and the site (apply_collection_delta) write it, so a
-- trigger compares the old and new counts and stamps every card whose count went up.
-- Cards already in a collection before this existed have no date.

create table if not exists public.collection_added (
  user_id uuid not null references auth.users(id) on delete cascade,
  profile text not null,
  card_id text not null check (length(card_id) between 1 and 40),
  added_at timestamptz not null default now(),
  qty int not null default 1,
  primary key (user_id, profile, card_id)
);
alter table public.collection_added enable row level security;
drop policy if exists collection_added_own on public.collection_added;
create policy collection_added_own on public.collection_added for select to authenticated using (user_id = (select auth.uid()));
revoke all on public.collection_added from anon;
grant select on public.collection_added to authenticated;

create or replace function public.stamp_collection_added()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.data->'collection' is not distinct from old.data->'collection' then return new; end if;
  insert into public.collection_added (user_id, profile, card_id, added_at, qty)
  select new.user_id, new.profile, n.key,
         now(),
         (coalesce((n.value->>'n')::int, 0) + coalesce((n.value->>'f')::int, 0))
           - (coalesce((o.value->>'n')::int, 0) + coalesce((o.value->>'f')::int, 0))
    from jsonb_each(case when jsonb_typeof(new.data->'collection') = 'object' then new.data->'collection' else '{}'::jsonb end) n
    left join jsonb_each(case when jsonb_typeof(old.data->'collection') = 'object' then old.data->'collection' else '{}'::jsonb end) o on o.key = n.key
   where jsonb_typeof(n.value) = 'object'
     and length(n.key) between 1 and 40
     and coalesce((n.value->>'n')::int, 0) + coalesce((n.value->>'f')::int, 0)
         > coalesce((o.value->>'n')::int, 0) + coalesce((o.value->>'f')::int, 0)
  on conflict (user_id, profile, card_id) do update set added_at = excluded.added_at, qty = excluded.qty;
  return new;
exception when others then
  return new;   -- a date is never worth failing a collection save
end $$;
revoke all on function public.stamp_collection_added() from public, anon, authenticated;

drop trigger if exists inkwell_profiles_collection_added on public.inkwell_profiles;
create trigger inkwell_profiles_collection_added
  after update of data on public.inkwell_profiles
  for each row execute function public.stamp_collection_added();
