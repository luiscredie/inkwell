-- Undo supabase/card_langs.sql: the collection functions go back to what they were before it (production,
-- 13/11/2026) and the language functions and their log are removed. Languages already saved in a collection
-- (data.collection.*.l) stay in the data, unused and harmless: n and f were never changed by them.
drop function if exists public.set_card_langs(uuid, text, text, jsonb, uuid);
drop function if exists public.mark_unknown_langs(uuid, text, jsonb, text, bigint, uuid);
drop function if exists public.undo_lang_op(uuid);
drop function if exists public.last_lang_op(uuid, text);
drop function if exists public.set_collection_prefs(uuid, text, jsonb);
drop function if exists public.collection_lang_state(uuid, text);
drop table if exists private.collection_lang_ops;

create or replace function private.valid_items(p jsonb) returns boolean language sql immutable set search_path to '' as $function$
  select jsonb_typeof(p) = 'array' and jsonb_array_length(p) <= 200 and not exists (
    select 1 from jsonb_array_elements(p) e
    where jsonb_typeof(e) <> 'object' or coalesce(e->>'card_id', '') = '' or length(e->>'card_id') > 40
       or jsonb_typeof(e->'qty') <> 'number' or (e->>'qty')::numeric not between 1 and 99);
$function$;

create or replace function private.collection_delta_for(u uuid, p_profile text, p_delta jsonb)
 returns void language plpgsql security definer set search_path to '' as $function$
declare d jsonb; e jsonb; cur jsonb; k text;
begin
  if jsonb_typeof(p_delta) <> 'array'
     or jsonb_array_length(p_delta) > 400 then
    raise exception 'bad delta';
  end if;
  select data into d
    from public.inkwell_profiles
   where user_id = u and profile = p_profile
   for update;
  if d is null then
    raise exception 'profile not found';
  end if;
  d := jsonb_set(d, '{collection}',
    coalesce(d->'collection', '{}'::jsonb));
  for e in select * from
      jsonb_array_elements(p_delta) loop
    if coalesce(e->>'card_id', '') = ''
       or length(e->>'card_id') > 40
       or jsonb_typeof(e->'qty') <> 'number'
    then
      raise exception 'bad delta item';
    end if;
    k := case when coalesce(
      (e->>'foil')::boolean, false)
      then 'f' else 'n' end;
    cur := coalesce(
      d->'collection'->(e->>'card_id'),
      '{"n": 0, "f": 0}'::jsonb);
    cur := jsonb_set(cur, array[k],
      to_jsonb(greatest(0, coalesce(
        (cur->>k)::int, 0)
        + (e->>'qty')::int)));
    d := jsonb_set(d, array['collection',
      e->>'card_id'], cur);
  end loop;
  update public.inkwell_profiles
     set data = d, revision = revision + 1,
         updated_at = now()
   where user_id = u and profile = p_profile;
end $function$;

create or replace function private.collection_op_delta(p jsonb)
 returns jsonb language plpgsql immutable set search_path to '' as $function$
declare e jsonb; out jsonb := '[]';
begin
  if jsonb_typeof(p) is distinct from
       'array'
     or jsonb_array_length(p) = 0
     or jsonb_array_length(p) > 400 then
    raise exception 'bad delta';
  end if;
  for e in select * from
      jsonb_array_elements(p) loop
    if jsonb_typeof(e) <> 'object'
       or coalesce(e->>'card_id', '') = ''
       or length(e->>'card_id') > 40
       or jsonb_typeof(e->'qty') <> 'number'
       or (e->>'qty') !~ '^[1-9][0-9]{0,2}$'
       or coalesce(jsonb_typeof(e->'foil'),
            'boolean') <> 'boolean' then
      raise exception 'bad delta item';
    end if;
    out := out || jsonb_build_array(
      jsonb_build_object(
        'card_id', e->>'card_id',
        'qty', (e->>'qty')::int,
        'foil', coalesce(
          (e->>'foil')::boolean, false)));
  end loop;
  return out;
end $function$;

create or replace function public.undo_collection_op(p_op uuid)
 returns jsonb language plpgsql security definer set search_path to '' as $function$
declare
  u uuid := auth.uid();
  o private.collection_ops;
  d jsonb; e jsonb; cur jsonb;
  k text; have int; q int;
begin
  if u is null then
    raise exception 'authentication_required'
      using errcode = '42501';
  end if;
  if p_op is null then
    raise exception 'bad op';
  end if;
  select * into o
    from private.collection_ops
   where op_id = p_op;
  if not found or o.user_id <> u then
    raise exception 'op_not_found';
  end if;
  select data into d
    from public.inkwell_profiles
   where user_id = u and profile = o.profile
   for update;
  if d is null then
    raise exception 'profile not found';
  end if;
  select * into o
    from private.collection_ops
   where op_id = p_op for update;
  if o.undone_at is not null then
    raise exception 'already_undone';
  end if;
  if o.created_at
     < now() - interval '10 minutes' then
    raise exception 'undo_expired';
  end if;
  d := jsonb_set(d, '{collection}',
    coalesce(d->'collection', '{}'::jsonb));
  for e in select * from
      jsonb_array_elements(o.delta) loop
    q := (e->>'qty')::int;
    k := case when (e->>'foil')::boolean
      then 'f' else 'n' end;
    cur := coalesce(
      d->'collection'->(e->>'card_id'),
      '{"n": 0, "f": 0}'::jsonb);
    have := coalesce((cur->>k)::int, 0);
    if have < q then
      raise exception 'collection_changed'
        using detail = (e->>'card_id')
          || ' ' || k || ' ' || have
          || ' < ' || q;
    end if;
    cur := jsonb_set(cur, array[k],
      to_jsonb(have - q));
    d := jsonb_set(d, array['collection',
      e->>'card_id'], cur);
  end loop;
  update public.inkwell_profiles
     set data = d, revision = revision + 1,
         updated_at = now()
   where user_id = u and profile = o.profile;
  update private.collection_ops
     set undone_at = now()
   where op_id = p_op;
  return jsonb_build_object(
    'status', 'undone');
end $function$;

drop function if exists private.entry_apply(jsonb, text, text, int, text, boolean);
drop function if exists private.can_edit_collection(uuid, text);
drop function if exists private.lang_known(jsonb, text);
drop function if exists private.langs_clean(jsonb);
drop function if exists private.lang_ok(text);
