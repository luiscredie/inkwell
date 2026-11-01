-- Conquistas: the Play Hub event it was won
-- at (Ravensburger). The page picks one of
-- the events you marked in Eventos, or reads
-- a pasted Play Hub link; the conquista keeps
-- the event's id, name and store, and links
-- to it. Run after achievements.sql (safe to
-- run again).

alter table public.achievements
  add column if not exists rph_id bigint,
  add column if not exists rph_name text
    check (length(rph_name) <= 120),
  add column if not exists rph_store text
    check (length(rph_store) <= 80);

create or replace function
  private.achievement_json(
    a public.achievements)
returns jsonb
language sql stable security definer
set search_path = '' as $$
  select jsonb_build_object(
    'id', a.id, 'kind', a.kind,
    'title', a.title, 'body', a.body,
    'on', a.happened_on, 'place', a.place,
    'image', a.image,
    'visibility', a.visibility,
    'rph_id', a.rph_id,
    'rph_name', a.rph_name,
    'rph_store', a.rph_store,
    'mine', a.user_id = auth.uid());
$$;

create or replace function
  public.save_achievement(p jsonb)
returns uuid
language plpgsql security definer
set search_path = '' as $$
declare
  u uuid := auth.uid(); aid uuid;
  d date; img text; rid bigint;
begin
  if u is null then
    raise exception 'authentication_required'
      using errcode = '42501';
  end if;
  d := coalesce(nullif(p->>'on', '')::date,
    current_date);
  if d < date '2023-01-01'
     or d > current_date + 1 then
    raise exception 'bad_date';
  end if;
  rid := case when coalesce(p->>'rph_id', '')
      ~ '^[0-9]{1,12}$'
    then (p->>'rph_id')::bigint end;
  img := nullif(p->>'image', '');
  if img is not null
     and img !~ ('^' || u::text
       || '/[a-z0-9-]{8,60}\.(jpg|webp)$')
  then
    raise exception 'bad_image';
  end if;
  if coalesce(p->>'id', '') = '' then
    perform private.rate_hit(
      'achievements', 20, interval '1 day');
    insert into public.achievements
      (user_id, kind, title, body,
       happened_on, place, image, visibility,
       rph_id, rph_name, rph_store)
    values (u,
      coalesce(p->>'kind', 'other'),
      btrim(coalesce(p->>'title', '')),
      left(coalesce(p->>'body', ''), 500),
      d, left(coalesce(p->>'place', ''), 80),
      img,
      coalesce(p->>'visibility', 'friends'),
      rid,
      left(nullif(p->>'rph_name', ''), 120),
      left(nullif(p->>'rph_store', ''), 80))
    returning id into aid;
    if coalesce((p->>'announce')::boolean,
         false) then
      insert into public.posts
        (author, body, visibility,
         achievement)
      values (u,
        left(btrim(coalesce(p->>'title', '')),
          200),
        coalesce(p->>'visibility', 'friends'),
        aid);
    end if;
  else
    update public.achievements
       set kind = coalesce(p->>'kind', kind),
           title = btrim(coalesce(
             p->>'title', title)),
           body = left(coalesce(
             p->>'body', body), 500),
           happened_on = d,
           place = left(coalesce(
             p->>'place', place), 80),
           image = img,
           visibility = coalesce(
             p->>'visibility', visibility),
           rph_id = rid,
           rph_name = left(nullif(
             p->>'rph_name', ''), 120),
           rph_store = left(nullif(
             p->>'rph_store', ''), 80)
     where id = (p->>'id')::uuid
       and user_id = u
    returning id into aid;
    if aid is null then
      raise exception 'not allowed'
        using errcode = '42501';
    end if;
    update public.posts
       set visibility = coalesce(
             p->>'visibility', visibility),
           body = left(btrim(coalesce(
             p->>'title', body)), 200)
     where achievement = aid;
  end if;
  return aid;
end $$;

