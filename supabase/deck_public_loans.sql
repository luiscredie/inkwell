-- Decks: "Mostrar no meu perfil público" and
-- friends who have a missing card.
--  * A deck with public = true shows on the
--    public profile and in the Lore Counter
--    search for people who are not friends
--    (only when the profile is public and
--    adult, like the featured deck).
--  * A friend whose collection is open to
--    friends (friends_view) now shows up on
--    a missing card even without "Aceito
--    pedidos de empréstimo". The request is
--    just a request: they say yes or no.
-- Run after decks.sql, find_player_decks.sql
-- and collection_shares.sql (safe to run
-- again).

-- save_deck: accept "public" (true/false)
do $$
declare d text;
begin
  d := pg_get_functiondef(
    'public.save_deck(text, jsonb)'
      ::regprocedure);
  if position('''bad public''' in d) = 0
  then
    d := replace(d,
      '''portfolioPriority'',''meta'')',
      '''portfolioPriority'',''meta'','
      || '''public'')');
    d := replace(d,
      '  if p_deck ? ''meta'' and',
      '  if p_deck ? ''public'' and '
      || 'jsonb_typeof(p_deck->''public'')'
      || ' <> ''boolean'' then' || chr(10)
      || '    raise exception ''bad public'';'
      || chr(10) || '  end if;' || chr(10)
      || '  if p_deck ? ''meta'' and');
    if position('''bad public''' in d) = 0
    then
      raise exception 'save_deck changed';
    end if;
    execute d;
  end if;
end $$;

-- friends with the card: collection open to
-- friends, or lending on. lend = they said
-- they take loan requests.
create or replace function
  public.friends_lending(p_cards text[])
returns jsonb
language sql stable security definer
set search_path = '' as $$
  with fr as (
    select case when requester = auth.uid()
             then addressee else requester
           end as uid
      from public.friendships
     where status = 'accepted'
       and auth.uid() in
         (requester, addressee)),
  have as (
    select fr.uid, cp.friends_lend lend,
      c.key as card_id,
      coalesce((c.value->>'n')::int, 0)
      + coalesce((c.value->>'f')::int, 0)
        as n
      from fr
      join public.collection_privacy cp
        on cp.user_id = fr.uid
       and (cp.friends_view
            or cp.friends_lend)
      join public.inkwell_profiles ip
        on ip.user_id = cp.user_id
       and ip.profile = cp.profile
     cross join lateral jsonb_each(
       case when jsonb_typeof(
              ip.data->'collection')
              = 'object'
         then ip.data->'collection'
         else '{}'::jsonb end) c
     where c.key = any(p_cards[1:400]))
  select coalesce(jsonb_agg(
      jsonb_build_object(
        'user', h.uid,
        'name', p.display_name,
        'handle', p.handle,
        'card_id', h.card_id,
        'lend', h.lend,
        'free', h.n - coalesce(l.qty, 0))
      order by h.lend desc,
        p.display_name), '[]'::jsonb)
    from have h
    left join public.profiles p
      on p.user_id = h.uid
    left join lateral (
      select qty
        from private.lent_out(h.uid) x
       where x.card_id = h.card_id) l
      on true
   where h.n - coalesce(l.qty, 0) > 0;
$$;
revoke all on function
  public.friends_lending(text[])
  from public, anon;
grant execute on function
  public.friends_lending(text[])
  to authenticated;

-- Lore Counter search: non-friends also see
-- the decks marked public
create or replace function
  public.find_player_decks(p_q text)
returns table(player uuid, name text,
  handle text, avatar text,
  friend boolean, deck_id text,
  deck_name text, colors jsonb)
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
         and (v.fr
           or x.d->>'id' = v.featured_deck
           or x.d->'public'
              = 'true'::jsonb)
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

-- the public decks of one Inkwell profile
-- (the featured one is shown apart)
create or replace function
  private.public_decks(p_data jsonb,
    p_feat text)
returns jsonb
language sql immutable
set search_path = '' as $$
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id', d->>'id',
      'name', d->>'name',
      'format', d->>'format',
      'colors', d->'colors',
      'cards', d->'cards')
    order by d->>'name'), '[]'::jsonb)
    from (select d
      from jsonb_array_elements(
        case when jsonb_typeof(
               p_data->'decks') = 'array'
          then p_data->'decks'
          else '[]'::jsonb end) d
     where d->'public' = 'true'::jsonb
       and coalesce(d->>'name', '') <> ''
       and (d->>'id') is distinct from
           p_feat
     limit 12) x;
$$;
revoke all on function
  private.public_decks(jsonb, text)
  from public;

-- public_profile: + public_decks
do $$
declare d text;
begin
  d := pg_get_functiondef(
    'public.public_profile(text)'
      ::regprocedure);
  if position('public_decks' in d) = 0
  then
    d := replace(d,
      '''deck'', deck,',
      '''deck'', deck,' || chr(10)
      || '    ''public_decks'','
      || ' private.public_decks(data,'
      || ' p.featured_deck),');
    if position('public_decks' in d) = 0
    then
      raise exception
        'public_profile changed';
    end if;
    execute d;
  end if;
end $$;
