-- Guest profile (Começar meu Inkwell):
-- a showcase card can say its finish.
-- Entries become {id, k, foil?}; foil is
-- kept only when true. Old entries have no
-- foil (normal). Run after my_inkwell_2.sql.
-- Rollback: run my_inkwell_2.sql again.

create or replace function
  public.save_my_profile(p jsonb)
returns jsonb
language plpgsql security definer
set search_path = '' as $$
declare
  cur public.profiles;
  h text;
begin
  if auth.uid() is null then
    raise exception 'authentication_required'
      using errcode = '42501';
  end if;
  if jsonb_typeof(p) <> 'object' then
    raise exception 'bad profile';
  end if;
  if exists (
    select 1 from jsonb_object_keys(p) k
     where k not in (
       'display_name', 'handle', 'bio',
       'motto', 'avatar_card', 'inks',
       'city', 'showcase', 'featured_deck',
       'inkwell_profile', 'is_public',
       'adult', 'show_record', 'show_trade'))
  then
    raise exception 'unknown field';
  end if;
  h := nullif(lower(btrim(
         coalesce(p->>'handle', ''))), '');
  if h is not null and exists (
    select 1 from public.profiles
     where lower(handle) = h
       and user_id <> auth.uid()) then
    raise exception 'handle_taken';
  end if;
  insert into public.profiles
    (user_id, display_name)
  values (auth.uid(), coalesce(
    nullif(btrim(p->>'display_name'), ''),
    'Jogador'))
  on conflict (user_id) do nothing;
  select * into cur from public.profiles
   where user_id = auth.uid() for update;
  update public.profiles set
    display_name = coalesce(
      nullif(btrim(p->>'display_name'), ''),
      cur.display_name),
    handle = case when p ? 'handle'
      then h else cur.handle end,
    bio = case when p ? 'bio'
      then btrim(coalesce(p->>'bio', ''))
      else cur.bio end,
    motto = case when p ? 'motto'
      then btrim(coalesce(p->>'motto', ''))
      else cur.motto end,
    avatar_card = case when p ? 'avatar_card'
      then nullif(p->>'avatar_card', '')
      else cur.avatar_card end,
    inks = case when p ? 'inks'
      then coalesce((
        select array_agg(x)
          from jsonb_array_elements_text(
                 p->'inks') x), '{}')
      else cur.inks end,
    city = case when p ? 'city'
      then btrim(coalesce(p->>'city', ''))
      else cur.city end,
    showcase = case when p ? 'showcase'
      then (
        select coalesce(jsonb_agg(
          jsonb_build_object(
            'id', left(e->>'id', 40),
            'k', case when e->>'k' = 'own'
                   then 'own' else 'fav' end)
          || case when e->>'foil' = 'true'
               then '{"foil": true}'::jsonb
               else '{}'::jsonb end),
          '[]'::jsonb)
        from jsonb_array_elements(
          case when jsonb_typeof(
                      p->'showcase') = 'array'
            then p->'showcase'
            else '[]'::jsonb end) e)
      else cur.showcase end,
    featured_deck =
      case when p ? 'featured_deck'
      then nullif(p->>'featured_deck', '')
      else cur.featured_deck end,
    inkwell_profile =
      case when p ? 'inkwell_profile'
      then nullif(p->>'inkwell_profile', '')
      else cur.inkwell_profile end,
    adult = case when p ? 'adult'
      then coalesce(
        (p->>'adult')::boolean, false)
      else cur.adult end,
    is_public = case when p ? 'is_public'
      then coalesce(
        (p->>'is_public')::boolean, false)
      else cur.is_public end,
    show_record = case when p ? 'show_record'
      then coalesce(
        (p->>'show_record')::boolean, true)
      else cur.show_record end,
    show_trade = case when p ? 'show_trade'
      then coalesce(
        (p->>'show_trade')::boolean, false)
      else cur.show_trade end,
    updated_at = now()
  where user_id = auth.uid();
  update public.profiles
     set is_public = false
   where user_id = auth.uid() and is_public
     and (handle is null or not adult
          or hidden_by_admin);
  return public.my_profile();
end $$;

revoke all on function
  public.save_my_profile(jsonb)
  from public, anon;
grant execute on function
  public.save_my_profile(jsonb)
  to authenticated;

create or replace function
  public.public_profile(p_handle text)
returns jsonb
language plpgsql stable security definer
set search_path = '' as $$
declare
  p public.profiles;
  data jsonb;
  owned jsonb := '{}'::jsonb;
  deck jsonb; rec jsonb; trade jsonb;
  show jsonb := '[]'::jsonb;
  e jsonb;
  friends jsonb; friends_n int;
  recs jsonb; rel text := null;
  f public.friendships;
begin
  select * into p from public.profiles
   where lower(handle) = lower(p_handle);
  if p.user_id is null or not p.is_public
     or not p.adult or p.hidden_by_admin then
    return null;
  end if;
  select ip.data into data
    from public.inkwell_profiles ip
   where ip.user_id = p.user_id
   order by (ip.profile = p.inkwell_profile)
            desc,
            jsonb_array_length(coalesce(
              case when jsonb_typeof(
                     ip.data->'decks') = 'array'
                then ip.data->'decks' end,
              '[]'::jsonb)) desc,
            ip.updated_at desc
   limit 1;
  if data is not null and jsonb_typeof(
       data->'collection') = 'object' then
    owned := data->'collection';
  end if;
  -- "own" only when the collection has
  -- that card in that finish
  for e in
    select * from jsonb_array_elements(
      p.showcase)
  loop
    show := show || jsonb_build_array(
      jsonb_build_object(
        'id', e->>'id',
        'foil', coalesce(
          (e->>'foil')::boolean, false),
        'own', (e->>'k') = 'own'
          and coalesce((owned
            -> (e->>'id')
            ->> (case when e->>'foil' = 'true'
                   then 'f' else 'n' end)
            )::int, 0) > 0));
  end loop;
  if p.featured_deck is not null
     and data is not null
     and jsonb_typeof(data->'decks')
         = 'array' then
    select jsonb_build_object(
             'name', d->>'name',
             'format', d->>'format',
             'colors', d->'colors',
             'cards', d->'cards')
      into deck
      from jsonb_array_elements(
             data->'decks') d
     where d->>'id' = p.featured_deck
     limit 1;
  end if;
  if p.show_record then
    select jsonb_build_object(
             'w', count(*) filter (
               where g.summary->>'result'
                     = 'win'),
             'l', count(*) filter (
               where g.summary->>'result'
                     = 'loss'))
      into rec
      from public.game_logs g
     where g.user_id = p.user_id;
  end if;
  if p.show_trade then
    trade := jsonb_build_object(
      'want', coalesce((
        select jsonb_agg(k) from (
          select k from jsonb_object_keys(
            case when jsonb_typeof(
                   data->'wishlist') = 'object'
              then data->'wishlist'
              else '{}'::jsonb end) k
          limit 12) x), '[]'::jsonb)
        || coalesce((
          select jsonb_agg(
                   distinct l.card_id)
            from public.listings l
           where l.user_id = p.user_id
             and l.kind in ('buy', 'borrow')),
          '[]'::jsonb),
      'have', coalesce((
        select jsonb_agg(distinct l.card_id)
          from public.listings l
         where l.user_id = p.user_id
           and l.kind in ('sell', 'lend')),
        '[]'::jsonb));
  end if;
  -- friends: only those with a public
  -- profile are named; the rest only count
  select count(*) into friends_n
    from public.friendships fr
   where fr.status = 'accepted'
     and p.user_id in
         (fr.requester, fr.addressee);
  select coalesce(jsonb_agg(
           jsonb_build_object(
             'name', o.display_name,
             'handle', o.handle,
             'avatar', o.avatar_card)
           order by fr.accepted_at
                    desc nulls last),
           '[]'::jsonb)
    into friends
    from public.friendships fr
    join public.profiles o
      on o.user_id = case
           when fr.requester = p.user_id
           then fr.addressee
           else fr.requester end
   where fr.status = 'accepted'
     and p.user_id in
         (fr.requester, fr.addressee)
     and o.is_public and o.adult
     and not o.hidden_by_admin
     and o.handle is not null;
  select coalesce(jsonb_agg(x), '[]'::jsonb)
    into recs
    from (
      select jsonb_build_object(
               'id', r.id,
               'body', r.body,
               'at', r.created_at,
               'name', a.display_name,
               'handle', case
                 when a.is_public and a.adult
                  and not a.hidden_by_admin
                 then a.handle end,
               'avatar', case
                 when a.is_public and a.adult
                  and not a.hidden_by_admin
                 then a.avatar_card end) x
        from public.recados r
        join public.profiles a
          on a.user_id = r.author
       where r.owner = p.user_id
         and r.status = 'shown'
         and not a.hidden_by_admin
       order by r.created_at desc
       limit 20) y;
  if auth.uid() is not null then
    if auth.uid() = p.user_id then
      rel := 'self';
    else
      select * into f
        from public.friendships
       where least(requester, addressee)
             = least(auth.uid(), p.user_id)
         and greatest(requester, addressee)
             = greatest(auth.uid(), p.user_id);
      rel := case
        when f.requester is null then 'none'
        when f.status = 'accepted'
          then 'friend'
        when f.requester = auth.uid()
          then 'asked'
        else 'asks_you' end;
    end if;
  end if;
  return jsonb_build_object(
    'handle', p.handle,
    'name', p.display_name,
    'bio', p.bio,
    'motto', p.motto,
    'avatar', p.avatar_card,
    'inks', to_jsonb(p.inks),
    'city', p.city,
    'showcase', show,
    'deck', deck,
    'record', rec,
    'trade', trade,
    'mock', p.is_mock,
    'friends', friends,
    'friends_n', friends_n,
    'recados', recs,
    'relation', rel,
    'can_recado', rel = 'friend'
      and coalesce((
        select adult from public.profiles
         where user_id = auth.uid()),
        false));
end $$;

revoke all on function
  public.public_profile(text)
  from public;
grant execute on function
  public.public_profile(text)
  to anon, authenticated;
