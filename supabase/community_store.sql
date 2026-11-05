-- Store communities: link a community (kind 'store') to its store on the Ravensburger Play Hub, so the
-- community shows that store's events. Run after community_admin.sql (safe to run again).
-- Undo: community_store_rollback.sql. Tests: tools/community_store_sql_test.sh.
--
-- Rules enforced here:
--   * the link uses the Play Hub store.id (never the name); name, city and address are only a snapshot to show;
--   * the community's owner or admin asks for the link; it stays "pending" until a site admin (public.admins)
--     approves or rejects it. Only "approved" means the representation was verified;
--   * one link per community; a store can be verified for one community only (and nobody can ask for a store
--     already verified elsewhere);
--   * changing the store sends the link back to "pending"; removing it is always allowed to the managers;
--   * every request, removal and decision is logged (private.community_store_log);
--   * tables are closed to clients: everything goes through the functions below.

create table if not exists public.community_stores (
  community_id uuid primary key references public.communities(id) on delete cascade,
  store_id bigint not null check (store_id between 1 and 999999999999),
  store_name text not null check (length(btrim(store_name)) between 1 and 120),
  store_city text check (length(store_city) <= 80),
  store_address text check (length(store_address) <= 300),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  requested_by uuid references auth.users(id) on delete set null,
  requested_at timestamptz not null default now(),
  decided_by uuid references auth.users(id) on delete set null,
  decided_at timestamptz,
  note text check (length(note) <= 300));
create index if not exists community_stores_store on public.community_stores (store_id);
-- the same store can't be verified for two communities
create unique index if not exists community_stores_one_verified on public.community_stores (store_id) where status = 'approved';

create table if not exists private.community_store_log (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  community_id uuid not null,
  store_id bigint,
  action text not null check (action in ('request', 'remove', 'approve', 'reject')),
  actor uuid,
  note text);

alter table public.community_stores enable row level security;
alter table private.community_store_log enable row level security;
revoke all on public.community_stores from anon, authenticated;
revoke all on private.community_store_log from anon, authenticated;

-- ask (or change) the store of a community: owner/admin of a store community
create or replace function public.request_community_store(p_slug text, p_store jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare c public.communities; cur public.community_stores; sid bigint;
  nm text := private.clip(p_store->>'name', 120);
begin
  if auth.uid() is null then raise exception 'authentication_required' using errcode = '42501'; end if;
  select * into c from public.communities where slug = p_slug and not hidden and not is_mock;
  if c.id is null or not private.can_manage(c.id) then raise exception 'not allowed' using errcode = '42501'; end if;
  if c.kind <> 'store' then raise exception 'not_a_store'; end if;
  if coalesce(p_store->>'id', '') !~ '^[0-9]{1,12}$' or (p_store->>'id')::bigint < 1 then raise exception 'bad_store_id'; end if;
  if nm is null then raise exception 'bad_store_name'; end if;
  sid := (p_store->>'id')::bigint;
  if exists (select 1 from public.community_stores where store_id = sid and status = 'approved' and community_id <> c.id) then
    raise exception 'store_taken';
  end if;
  select * into cur from public.community_stores where community_id = c.id;
  if cur.store_id = sid and cur.status = 'approved' then   -- same store, already verified: nothing to ask
    return jsonb_build_object('store_id', sid, 'status', 'approved');
  end if;
  insert into public.community_stores (community_id, store_id, store_name, store_city, store_address, status, requested_by, requested_at)
  values (c.id, sid, nm, private.clip(p_store->>'city', 80), private.clip(p_store->>'address', 300), 'pending', auth.uid(), now())
  on conflict (community_id) do update set store_id = excluded.store_id, store_name = excluded.store_name, store_city = excluded.store_city,
    store_address = excluded.store_address, status = 'pending', requested_by = excluded.requested_by, requested_at = now(),
    decided_by = null, decided_at = null, note = null;
  insert into private.community_store_log (community_id, store_id, action, actor) values (c.id, sid, 'request', auth.uid());
  return jsonb_build_object('store_id', sid, 'status', 'pending');
end $$;

create or replace function public.remove_community_store(p_slug text)
returns void language plpgsql security definer set search_path = '' as $$
declare c public.communities; old bigint;
begin
  select * into c from public.communities where slug = p_slug and not hidden;
  if c.id is null or auth.uid() is null or not private.can_manage(c.id) then raise exception 'not allowed' using errcode = '42501'; end if;
  delete from public.community_stores where community_id = c.id returning store_id into old;
  if old is not null then insert into private.community_store_log (community_id, store_id, action, actor) values (c.id, old, 'remove', auth.uid()); end if;
end $$;

-- what the community page shows. Everyone: the store and whether it is verified (pending ones too, labelled as
-- not verified). A rejected link only to the managers. Only for store communities.
create or replace function public.community_store(p_slug text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare c public.communities; s public.community_stores; mgr boolean;
begin
  select * into c from public.communities where slug = p_slug and not hidden;
  if c.id is null or c.kind <> 'store' then return null; end if;
  select * into s from public.community_stores where community_id = c.id;
  if s.community_id is null then return null; end if;
  mgr := auth.uid() is not null and private.can_manage(c.id);
  if s.status = 'rejected' and not mgr then return null; end if;
  return jsonb_build_object('store_id', s.store_id, 'name', s.store_name, 'city', s.store_city, 'address', s.store_address,
      'status', s.status, 'verified', s.status = 'approved')
    || case when mgr then jsonb_build_object('note', s.note, 'requested_at', s.requested_at, 'decided_at', s.decided_at) else '{}'::jsonb end;
end $$;

-- site admins: the queue, and the decision
create or replace function public.admin_community_stores(p_status text default 'pending')
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.is_admin() then raise exception 'not allowed' using errcode = '42501'; end if;
  return (select coalesce(jsonb_agg(jsonb_build_object('community_id', s.community_id, 'slug', c.slug, 'community', c.name,
      'store_id', s.store_id, 'name', s.store_name, 'city', s.store_city, 'address', s.store_address, 'status', s.status,
      'requested_by', p.display_name, 'requested_at', s.requested_at, 'note', s.note,
      'verified_elsewhere', exists (select 1 from public.community_stores o where o.store_id = s.store_id and o.status = 'approved' and o.community_id <> s.community_id))
      order by s.requested_at), '[]'::jsonb)
    from public.community_stores s join public.communities c on c.id = s.community_id
    left join public.profiles p on p.user_id = s.requested_by
   where p_status is null or s.status = p_status);
end $$;

create or replace function public.decide_community_store(p_community uuid, p_decision text, p_note text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare s public.community_stores;
begin
  if not private.is_admin() then raise exception 'not allowed' using errcode = '42501'; end if;
  if p_decision not in ('approved', 'rejected') then raise exception 'bad_decision'; end if;
  select * into s from public.community_stores where community_id = p_community for update;
  if s.community_id is null then raise exception 'no_request'; end if;
  if p_decision = 'approved' and exists (select 1 from public.community_stores where store_id = s.store_id and status = 'approved' and community_id <> p_community) then
    raise exception 'store_taken';
  end if;
  update public.community_stores set status = p_decision, decided_by = auth.uid(), decided_at = now(), note = private.clip(p_note, 300)
   where community_id = p_community;
  insert into private.community_store_log (community_id, store_id, action, actor, note)
  values (p_community, s.store_id, case p_decision when 'approved' then 'approve' else 'reject' end, auth.uid(), private.clip(p_note, 300));
end $$;

revoke all on function public.request_community_store(text, jsonb), public.remove_community_store(text), public.community_store(text),
  public.admin_community_stores(text), public.decide_community_store(uuid, text, text) from public, anon, authenticated;
grant execute on function public.community_store(text) to anon, authenticated;
grant execute on function public.request_community_store(text, jsonb), public.remove_community_store(text),
  public.admin_community_stores(text), public.decide_community_store(uuid, text, text) to authenticated;
