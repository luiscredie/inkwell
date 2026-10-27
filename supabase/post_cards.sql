-- Posts with up to 5 cards, optionally marked
-- as a combo. The first card also stays in
-- card_id/foil, so older pages still show it.
-- Run after social.sql.

alter table public.posts
  add column if not exists cards jsonb
    check (cards is null
      or (jsonb_typeof(cards) = 'array'
      and jsonb_array_length(cards)
        between 1 and 5
      and length(cards::text) <= 600));
alter table public.posts
  add column if not exists combo boolean
    not null default false;

-- [{id, foil}] from what the page sent:
-- known shape only, ids trimmed, max 5
create or replace function
  private.clean_cards(p jsonb)
returns jsonb
language sql immutable
set search_path = '' as $$
  select nullif(coalesce(jsonb_agg(
           jsonb_build_object(
             'id', x.id, 'foil', x.foil)
           order by x.n), '[]'::jsonb),
         '[]'::jsonb)
    from (
    select left(btrim(e->>'id'), 40) id,
           coalesce((e->>'foil')::boolean,
             false) foil, n
      from jsonb_array_elements(
        case when jsonb_typeof(p) = 'array'
          then p else '[]'::jsonb end)
        with ordinality t(e, n)
     where jsonb_typeof(e) = 'object'
       and coalesce(btrim(e->>'id'), '')
         ~ '^[A-Za-z0-9_-]{1,40}$'
     order by n
     limit 5) x;
$$;

create or replace function
  private.post_json(p public.posts)
returns jsonb
language sql stable security definer
set search_path = '' as $$
  select private.face(p.author)
    || jsonb_build_object(
      'id', p.id, 'author', p.author,
      'body', p.body,
      'card', p.card_id, 'foil', p.foil,
      'cards', coalesce(p.cards,
        case when p.card_id is not null
          then jsonb_build_array(
            jsonb_build_object(
              'id', p.card_id,
              'foil', p.foil)) end),
      'combo', p.combo,
      'deck', p.deck,
      'visibility', p.visibility,
      'at', p.created_at,
      'mine', p.author = auth.uid(),
      'likes', (select count(*)
        from public.post_likes l
       where l.post_id = p.id),
      'liked', exists (select 1
        from public.post_likes l
       where l.post_id = p.id
         and l.user_id = auth.uid()),
      'comments_n', (select count(*)
        from public.post_comments c
       where c.post_id = p.id
         and not c.hidden),
      'comments', coalesce((
        select jsonb_agg(x.j order by x.at)
          from (
          select c.created_at at,
                 private.face(c.author)
                 || jsonb_build_object(
                   'id', c.id,
                   'body', c.body,
                   'at', c.created_at,
                   'mine',
                     c.author = auth.uid())
                 j
            from public.post_comments c
           where c.post_id = p.id
             and not c.hidden
           order by c.created_at desc
           limit 3) x), '[]'::jsonb));
$$;

drop function if exists public.create_post(
  text, text, boolean, jsonb, text);
create or replace function
  public.create_post(
    p_body text, p_card text default null,
    p_foil boolean default false,
    p_deck jsonb default null,
    p_visibility text default 'friends',
    p_cards jsonb default null,
    p_combo boolean default false)
returns jsonb
language plpgsql security definer
set search_path = '' as $$
declare r public.posts; cs jsonb;
begin
  perform private.need_adult();
  cs := private.clean_cards(p_cards);
  if cs is null and nullif(btrim(
       coalesce(p_card, '')), '') is not null
  then
    cs := private.clean_cards(
      jsonb_build_array(jsonb_build_object(
        'id', p_card, 'foil', p_foil)));
  end if;
  if length(btrim(coalesce(p_body, '')))
       = 0 and cs is null
     and p_deck is null then
    raise exception 'empty post';
  end if;
  if (select count(*) from public.posts
       where author = auth.uid()
         and created_at
           > now() - interval '1 day')
     >= 30 then
    raise exception 'too many posts';
  end if;
  insert into public.posts
    (author, body, card_id, foil, cards,
     combo, deck, visibility)
  values (auth.uid(),
    btrim(coalesce(p_body, '')),
    cs->0->>'id',
    coalesce((cs->0->>'foil')::boolean,
      false),
    cs,
    coalesce(p_combo, false)
      and jsonb_array_length(
        coalesce(cs, '[]')) > 1,
    case when jsonb_typeof(p_deck)
           = 'object' then p_deck end,
    case when p_visibility = 'public'
      then 'public' else 'friends' end)
  returning * into r;
  return private.post_json(r);
end $$;

revoke all on function public.create_post(
  text, text, boolean, jsonb, text,
  jsonb, boolean) from public, anon;
grant execute on function
  public.create_post(text, text, boolean,
    jsonb, text, jsonb, boolean)
  to authenticated;
