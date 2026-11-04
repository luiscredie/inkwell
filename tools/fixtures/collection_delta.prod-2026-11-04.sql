-- production's collection delta functions, read 04/11/2026 (read-only query), for the local tests
create schema if not exists private;
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
create or replace function public.apply_collection_delta(p_profile text, p_delta jsonb)
 returns void language plpgsql security definer set search_path to '' as $function$
begin
  if auth.uid() is null then
    raise exception 'authentication_required'
      using errcode = '42501';
  end if;
  perform private.collection_delta_for(
    auth.uid(), p_profile, p_delta);
end $function$;
revoke all on function public.apply_collection_delta(text, jsonb) from public, anon;
grant execute on function public.apply_collection_delta(text, jsonb) to authenticated;
