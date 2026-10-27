-- Eventos: my marks on Play Hub events (going
-- or maybe, registered, paid), friends' marks,
-- and reminders the day before (also for the
-- community tables I said "Vou" to).
-- Run after social.sql.

create table if not exists
  public.event_marks (
  user_id uuid not null
    references auth.users(id)
    on delete cascade,
  rph_id bigint not null,
  status text not null
    check (status in ('going', 'maybe')),
  registered boolean not null default false,
  paid boolean not null default false,
  snap jsonb not null default '{}'
    check (length(snap::text) <= 3000),
  starts_at timestamptz,
  updated_at timestamptz not null
    default now(),
  primary key (user_id, rph_id));
create index if not exists event_marks_rph
  on public.event_marks (rph_id);
create index if not exists event_marks_start
  on public.event_marks (starts_at);
alter table public.event_marks
  enable row level security;

-- mark, change or clear (p_status null)
create or replace function
  public.mark_event(
    p_rph_id bigint, p_status text,
    p_registered boolean default false,
    p_paid boolean default false,
    p_snap jsonb default '{}')
returns void
language plpgsql security definer
set search_path = '' as $$
begin
  if auth.uid() is null then
    raise exception 'authentication_required'
      using errcode = '42501';
  end if;
  if p_status is null
     or p_status not in ('going', 'maybe')
  then
    delete from public.event_marks
     where user_id = auth.uid()
       and rph_id = p_rph_id;
    return;
  end if;
  insert into public.event_marks
    (user_id, rph_id, status, registered,
     paid, snap, starts_at)
  values (auth.uid(), p_rph_id, p_status,
    coalesce(p_registered, false),
    coalesce(p_paid, false),
    coalesce(p_snap, '{}'),
    (p_snap->>'start')::timestamptz)
  on conflict (user_id, rph_id) do update
    set status = excluded.status,
        registered = excluded.registered,
        paid = excluded.paid,
        snap = case
          when excluded.snap = '{}'::jsonb
          then public.event_marks.snap
          else excluded.snap end,
        starts_at = coalesce(
          excluded.starts_at,
          public.event_marks.starts_at),
        updated_at = now();
end $$;

-- mine (with what I saved of each event)
create or replace function
  public.my_event_marks()
returns jsonb
language sql stable security definer
set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'rph_id', m.rph_id, 'status', m.status,
    'registered', m.registered,
    'paid', m.paid, 'snap', m.snap)
    order by m.starts_at), '[]'::jsonb)
    from public.event_marks m
   where m.user_id = auth.uid()
     and (m.starts_at is null
       or m.starts_at
         > now() - interval '30 days');
$$;

-- which of my friends go to these events
create or replace function
  public.friends_on_events(p_ids bigint[])
returns jsonb
language sql stable security definer
set search_path = '' as $$
  select coalesce(jsonb_object_agg(x.rph_id,
           x.people), '{}'::jsonb)
    from (
    select m.rph_id, jsonb_agg(
             private.face(m.user_id)
             || jsonb_build_object(
               'status', m.status)) people
      from public.event_marks m
     where m.rph_id = any(p_ids[1:300])
       and m.user_id <> auth.uid()
       and private.are_friends(
             m.user_id, auth.uid())
     group by m.rph_id) x;
$$;

-- the day before: a notice for Play Hub events
-- I marked "going" and community tables I said
-- "Vou" to (once each)
create or replace function
  private.remind_events()
returns void
language sql security definer
set search_path = '' as $$
  insert into public.notifications
    (user_id, kind, actor, ref)
  select m.user_id, 'event_soon', null,
         jsonb_build_object(
           'rph', m.rph_id,
           'text', m.snap->>'name',
           'at', m.starts_at)
    from public.event_marks m
   where m.status = 'going'
     and m.starts_at
       between now() and now() + interval '1 day'
     and not exists (
       select 1 from public.notifications n
        where n.user_id = m.user_id
          and n.kind = 'event_soon'
          and n.ref->>'rph' = m.rph_id::text);
  insert into public.notifications
    (user_id, kind, actor, ref)
  select r.user_id, 'event_soon', null,
         jsonb_build_object(
           'event', e.id, 'text', e.title,
           'slug', c.slug, 'at', e.starts_at)
    from public.event_rsvps r
    join public.events e on e.id = r.event_id
    join public.communities c
      on c.id = e.community_id
   where r.status = 'going'
     and not e.cancelled
     and e.starts_at
       between now() and now() + interval '1 day'
     and not exists (
       select 1 from public.notifications n
        where n.user_id = r.user_id
          and n.kind = 'event_soon'
          and n.ref->>'event' = e.id::text);
$$;

-- every hour
select cron.unschedule('inkwell-remind-events')
 where exists (select 1 from cron.job
   where jobname = 'inkwell-remind-events');
select cron.schedule('inkwell-remind-events',
  '7 * * * *',
  'select private.remind_events()');

revoke all on function
  public.mark_event(bigint, text, boolean,
    boolean, jsonb)
  from public, anon;
grant execute on function
  public.mark_event(bigint, text, boolean,
    boolean, jsonb)
  to authenticated;
revoke all on function
  public.my_event_marks() from public, anon;
grant execute on function
  public.my_event_marks() to authenticated;
revoke all on function
  public.friends_on_events(bigint[])
  from public, anon;
grant execute on function
  public.friends_on_events(bigint[])
  to authenticated;
