-- Decks page (/decks/): save or delete one deck inside the player's Inkwell profile
-- without sending the whole profile. Same pattern as apply_collection_delta: the row
-- is locked, only data->decks changes, and revision goes up so the Inkwell app sees
-- a newer cloud copy instead of overwriting it.

create or replace function public.save_deck(p_profile text, p_deck jsonb)
returns jsonb
language plpgsql
set search_path to ''
as $$
declare
  d jsonb; decks jsonb; out jsonb := '[]'::jsonb; e jsonb; saved jsonb; found boolean := false;
  k text; v jsonb; n int := 0;
begin
  if auth.uid() is null then raise exception 'authentication_required' using errcode = '42501'; end if;
  if jsonb_typeof(p_deck) <> 'object' then raise exception 'bad deck'; end if;
  if coalesce(p_deck->>'id', '') !~ '^[A-Za-z0-9_-]{1,60}$' then raise exception 'bad deck id'; end if;
  if length(coalesce(p_deck->>'name', '')) not between 1 and 80 then raise exception 'bad deck name'; end if;
  if coalesce(p_deck->>'format', 'core') not in ('core', 'infinity') then raise exception 'bad format'; end if;
  if jsonb_typeof(coalesce(p_deck->'cards', '{}'::jsonb)) <> 'object' then raise exception 'bad cards'; end if;
  for k, v in select * from jsonb_each(coalesce(p_deck->'cards', '{}'::jsonb)) loop
    n := n + 1;
    if n > 200 or length(k) > 40 or jsonb_typeof(v) <> 'number' or (v::text)::numeric not between 0 and 99
       or (v::text)::numeric <> trunc((v::text)::numeric) then raise exception 'bad card entry'; end if;
  end loop;
  if p_deck ? 'colors' and (jsonb_typeof(p_deck->'colors') <> 'array' or jsonb_array_length(p_deck->'colors') > 3) then raise exception 'bad colors'; end if;
  if length(coalesce(p_deck->>'notes', '')) > 4000 then raise exception 'bad notes'; end if;
  if exists (select 1 from jsonb_object_keys(p_deck) fk where fk not in ('id','name','format','colors','cards','notes','targetCopies','portfolioPriority','meta')) then raise exception 'unknown deck field'; end if;
  -- meta: the set whose metagame the deck is for (LOR12, LOR13, …); null clears it
  if p_deck ? 'meta' and jsonb_typeof(p_deck->'meta') <> 'null' and coalesce(p_deck->>'meta', '') !~ '^LOR[0-9]{1,2}$' then raise exception 'bad meta'; end if;
  if p_deck ? 'targetCopies' and (jsonb_typeof(p_deck->'targetCopies') <> 'number' or (p_deck->>'targetCopies')::numeric not in (0,1,2,3,4,5,6,7,8,9,10)) then raise exception 'bad targetCopies'; end if;
  if p_deck ? 'portfolioPriority' and (jsonb_typeof(p_deck->'portfolioPriority') <> 'number' or abs((p_deck->>'portfolioPriority')::numeric) > 999) then raise exception 'bad priority'; end if;

  select data into d from public.inkwell_profiles where user_id = auth.uid() and profile = p_profile for update;
  if d is null then raise exception 'profile not found'; end if;
  decks := case when jsonb_typeof(d->'decks') = 'array' then d->'decks' else '[]'::jsonb end;
  if jsonb_array_length(decks) >= 200 and not exists (select 1 from jsonb_array_elements(decks) x where x->>'id' = p_deck->>'id') then
    raise exception 'too many decks';
  end if;

  for e in select * from jsonb_array_elements(decks) loop
    if e->>'id' = p_deck->>'id' then
      -- keep fields this page does not edit (targetCopies, portfolioPriority, created_at, ...)
      saved := e || (p_deck - 'created_at') || jsonb_build_object('updated_at', now());
      out := out || jsonb_build_array(saved); found := true;
    else
      out := out || jsonb_build_array(e);
    end if;
  end loop;
  if not found then
    saved := jsonb_build_object('notes', '', 'targetCopies', 1, 'portfolioPriority', 0, 'format', 'core', 'colors', '[]'::jsonb, 'cards', '{}'::jsonb)
             || p_deck || jsonb_build_object('created_at', to_char(now(), 'YYYY-MM-DD'), 'updated_at', now());
    out := out || jsonb_build_array(saved);
  end if;

  update public.inkwell_profiles set data = jsonb_set(d, '{decks}', out), revision = revision + 1, updated_at = now()
   where user_id = auth.uid() and profile = p_profile;
  return saved;
end $$;

create or replace function public.delete_deck(p_profile text, p_deck_id text)
returns void
language plpgsql
set search_path to ''
as $$
declare d jsonb; out jsonb;
begin
  if auth.uid() is null then raise exception 'authentication_required' using errcode = '42501'; end if;
  select data into d from public.inkwell_profiles where user_id = auth.uid() and profile = p_profile for update;
  if d is null then raise exception 'profile not found'; end if;
  select coalesce(jsonb_agg(x), '[]'::jsonb) into out
    from jsonb_array_elements(case when jsonb_typeof(d->'decks') = 'array' then d->'decks' else '[]'::jsonb end) x
   where x->>'id' is distinct from p_deck_id;
  d := jsonb_set(d, '{decks}', out);
  if d->>'activeDeckId' = p_deck_id then d := jsonb_set(d, '{activeDeckId}', 'null'::jsonb); end if;
  update public.inkwell_profiles set data = d, revision = revision + 1, updated_at = now()
   where user_id = auth.uid() and profile = p_profile;
end $$;

revoke all on function public.save_deck(text, jsonb) from public, anon;
revoke all on function public.delete_deck(text, text) from public, anon;
grant execute on function public.save_deck(text, jsonb) to authenticated;
grant execute on function public.delete_deck(text, text) to authenticated;
