-- Lore counter: "O oponente usa o Inkwell?"
-- Search a player by name or @handle and list
-- the decks you may see: their featured deck
-- when the profile is public, every deck when
-- you are friends. Name and inks only, never
-- the card list. Signed-in players only.

create or replace function
  public.find_player_decks(p_q text)
returns table (
  player uuid, name text, handle text,
  avatar text, friend boolean,
  deck_id text, deck_name text,
  colors jsonb)
language plpgsql stable security definer
set search_path = '' as $$
declare
  q text := btrim(coalesce(p_q, ''));
  pat text;
begin
  if auth.uid() is null then
    raise exception 'authentication_required'
      using errcode = '42501';
  end if;
  if length(q) < 2 then return; end if;
  pat := '%' || replace(replace(replace(
    lower(left(q, 40)), '\', '\\'),
    '%', '\%'), '_', '\_') || '%';
  return query
  with ps as (
    select p.user_id, p.display_name,
           p.handle, p.avatar_card,
           p.featured_deck, p.is_public,
           p.adult,
           private.are_friends(
             auth.uid(), p.user_id) as fr
      from public.profiles p
     where p.user_id <> auth.uid()
       and not p.hidden_by_admin
       and not p.is_mock
       and (lower(p.display_name) like pat
            or lower(coalesce(p.handle, ''))
               like pat)
  ), vis as (
    select * from ps
     where fr or (is_public and adult)
     limit 20
  )
  select v.user_id, v.display_name,
         case when v.is_public and v.adult
              then v.handle end,
         v.avatar_card, v.fr,
         d->>'id', d->>'name',
         coalesce(d->'colors', '[]'::jsonb)
    from vis v
    left join lateral (
      select x.d
        from public.inkwell_profiles ip,
             jsonb_array_elements(
               case when jsonb_typeof(
                      ip.data->'decks')
                      = 'array'
                 then ip.data->'decks'
                 else '[]'::jsonb end) x(d)
       where ip.user_id = v.user_id
         and coalesce(x.d->>'name', '') <> ''
         and (v.fr or x.d->>'id'
                      = v.featured_deck)
    ) dd on true
   order by v.fr desc, v.display_name,
            d->>'name';
end $$;

revoke all on function
  public.find_player_decks(text)
  from public, anon;
grant execute on function
  public.find_player_decks(text)
  to authenticated;
