-- Past events in Eventos: after an event, mark
-- "Fui" (went) or "Não fui" (missed). "Fui"
-- links to the results on the Play Hub and
-- to "Registrar conquista". My marks now
-- reach back 180 days, so past events stay
-- listed. Run after event_marks.sql (safe to
-- run again).

alter table public.event_marks
  drop constraint if exists
    event_marks_status_check;
alter table public.event_marks
  add constraint event_marks_status_check
  check (status in ('going', 'maybe',
    'went', 'missed'));

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
     or p_status not in ('going', 'maybe',
       'went', 'missed')
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
         > now() - interval '180 days');
$$;
