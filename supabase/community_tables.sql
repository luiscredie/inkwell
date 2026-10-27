-- Mesas & Ligas: delete a table, and link a
-- table to its Play Hub event (so Eventos shows
-- them as one, and the table points to the
-- Play Hub to register).
-- Run after social.sql.

alter table public.events
  add column if not exists rph_id bigint
    check (rph_id is null or rph_id > 0);
create index if not exists events_rph
  on public.events (rph_id)
  where rph_id is not null;

-- one table, as the pages show it (+ rph_id)
create or replace function
  private.event_json(e public.events)
returns jsonb
language sql stable security definer
set search_path = '' as $$
  select jsonb_build_object(
    'id', e.id, 'title', e.title,
    'starts_at', e.starts_at,
    'place', e.place,
    'details', e.details,
    'capacity', e.capacity,
    'cancelled', e.cancelled,
    'rph_id', e.rph_id,
    'community', c.name, 'slug', c.slug,
    'avatar', c.avatar_card,
    'going', (select count(*)
      from public.event_rsvps r
     where r.event_id = e.id
       and r.status = 'going'),
    'maybe', (select count(*)
      from public.event_rsvps r
     where r.event_id = e.id
       and r.status = 'maybe'),
    'me', (select r.status
      from public.event_rsvps r
     where r.event_id = e.id
       and r.user_id = auth.uid()),
    'can_edit',
      private.can_manage(e.community_id),
    'people', coalesce((
      select jsonb_agg(private.face(r.user_id)
        || jsonb_build_object(
          'status', r.status)
        order by r.created_at)
        from public.event_rsvps r
        join public.profiles p
          on p.user_id = r.user_id
       where r.event_id = e.id
         and p.is_public and p.adult
         and not p.hidden_by_admin),
      '[]'::jsonb))
    from public.communities c
   where c.id = e.community_id;
$$;

-- owner/admin: link to a Play Hub event, or
-- unlink (null)
create or replace function
  public.link_event_rph(
    p_event uuid, p_rph_id bigint)
returns jsonb
language plpgsql security definer
set search_path = '' as $$
declare e public.events;
begin
  select * into e from public.events
   where id = p_event;
  if e.id is null
     or not private.can_manage(
       e.community_id) then
    raise exception 'not allowed'
      using errcode = '42501';
  end if;
  update public.events
     set rph_id = p_rph_id
   where id = p_event
  returning * into e;
  return private.event_json(e);
end $$;

-- owner/admin: delete a table for good (its
-- "Vou" and its notices go with it). To keep
-- it visible as cancelled, use "Cancelar".
create or replace function
  public.delete_event(p_event uuid)
returns void
language plpgsql security definer
set search_path = '' as $$
declare cid uuid;
begin
  select community_id into cid
    from public.events where id = p_event;
  if cid is null
     or not private.can_manage(cid) then
    raise exception 'not allowed'
      using errcode = '42501';
  end if;
  delete from public.notifications
   where ref->>'event' = p_event::text;
  delete from public.events
   where id = p_event;
end $$;

-- Eventos: which Play Hub events have a table
-- in a community (anyone sees community
-- tables, like the community page)
create or replace function
  public.rph_tables(p_ids bigint[])
returns jsonb
language sql stable security definer
set search_path = '' as $$
  select coalesce(jsonb_object_agg(x.rph_id,
           x.tables), '{}'::jsonb)
    from (
    select e.rph_id, jsonb_agg(
             private.event_json(e)
             order by e.starts_at) tables
      from public.events e
      join public.communities c
        on c.id = e.community_id
     where e.rph_id = any(p_ids[1:400])
       and not c.hidden
       and not e.cancelled
       and e.starts_at
         > now() - interval '1 day'
     group by e.rph_id) x;
$$;

revoke all on function
  public.link_event_rph(uuid, bigint)
  from public, anon;
grant execute on function
  public.link_event_rph(uuid, bigint)
  to authenticated;
revoke all on function
  public.delete_event(uuid)
  from public, anon;
grant execute on function
  public.delete_event(uuid) to authenticated;
revoke all on function
  public.rph_tables(bigint[]) from public;
grant execute on function
  public.rph_tables(bigint[])
  to anon, authenticated;
