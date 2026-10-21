-- Preços page (/precos/): add, retarget or remove one wishlist entry inside the player's Inkwell
-- profile (data->wishlist[card_id] = 1 | {"t": target BRL}), without sending the whole profile.
-- Same pattern as apply_collection_delta: row locked, revision bumped.
create or replace function public.set_wishlist(p_profile text, p_card_id text, p_target numeric default null, p_remove boolean default false)
returns void
language plpgsql
set search_path to ''
as $$
declare d jsonb;
begin
  if auth.uid() is null then raise exception 'authentication_required' using errcode = '42501'; end if;
  if coalesce(p_card_id, '') = '' or length(p_card_id) > 40 then raise exception 'bad card id'; end if;
  if p_target is not null and (p_target <= 0 or p_target > 100000) then raise exception 'bad target'; end if;
  select data into d from public.inkwell_profiles where user_id = auth.uid() and profile = p_profile for update;
  if d is null then raise exception 'profile not found'; end if;
  d := jsonb_set(d, '{wishlist}', case when jsonb_typeof(d->'wishlist') = 'object' then d->'wishlist' else '{}'::jsonb end);
  if p_remove then
    d := jsonb_set(d, '{wishlist}', (d->'wishlist') - p_card_id);
  else
    d := jsonb_set(d, array['wishlist', p_card_id], case when p_target is null then '1'::jsonb else jsonb_build_object('t', round(p_target, 2)) end);
  end if;
  update public.inkwell_profiles set data = d, revision = revision + 1, updated_at = now()
   where user_id = auth.uid() and profile = p_profile;
end $$;

revoke all on function public.set_wishlist(text, text, numeric, boolean) from public, anon;
grant execute on function public.set_wishlist(text, text, numeric, boolean) to authenticated;
