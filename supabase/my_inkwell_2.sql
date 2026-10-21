-- My Inkwell, part 2: motto, visible friends, recados (approved by the profile owner),
-- invites that ask before adding a friend, and the named example profiles.
-- Run after my_inkwell.sql (safe to run again).
--
-- Recados rules (enforced here):
--   * only friends can leave one, and both people must have declared 18+;
--   * a recado appears only after the profile owner approves it, and only on a public profile;
--   * the owner can hide or delete any recado; the author can delete their own; 20 a day per author.

-- ---------- motto ----------
alter table public.profiles add column if not exists motto text not null default '';
alter table public.profiles drop constraint if exists profiles_motto_ok;
alter table public.profiles add constraint profiles_motto_ok check (length(motto) <= 60);

create or replace function public.save_my_profile(p jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare cur public.profiles; h text;
begin
  if auth.uid() is null then raise exception 'authentication_required' using errcode = '42501'; end if;
  if jsonb_typeof(p) <> 'object' then raise exception 'bad profile'; end if;
  if exists (select 1 from jsonb_object_keys(p) k where k not in ('display_name','handle','bio','motto','avatar_card','inks','city','showcase','featured_deck','inkwell_profile','is_public','adult','show_record','show_trade'))
    then raise exception 'unknown field'; end if;
  h := nullif(lower(btrim(coalesce(p->>'handle', ''))), '');
  if h is not null and exists (select 1 from public.profiles where lower(handle) = h and user_id <> auth.uid()) then raise exception 'handle_taken'; end if;
  insert into public.profiles (user_id, display_name) values (auth.uid(), coalesce(nullif(btrim(p->>'display_name'), ''), 'Jogador'))
    on conflict (user_id) do nothing;
  select * into cur from public.profiles where user_id = auth.uid() for update;
  update public.profiles set
    display_name = coalesce(nullif(btrim(p->>'display_name'), ''), cur.display_name),
    handle = case when p ? 'handle' then h else cur.handle end,
    bio = case when p ? 'bio' then btrim(coalesce(p->>'bio', '')) else cur.bio end,
    motto = case when p ? 'motto' then btrim(coalesce(p->>'motto', '')) else cur.motto end,
    avatar_card = case when p ? 'avatar_card' then nullif(p->>'avatar_card', '') else cur.avatar_card end,
    inks = case when p ? 'inks' then coalesce((select array_agg(x) from jsonb_array_elements_text(p->'inks') x), '{}') else cur.inks end,
    city = case when p ? 'city' then btrim(coalesce(p->>'city', '')) else cur.city end,
    showcase = case when p ? 'showcase' then (select coalesce(jsonb_agg(jsonb_build_object('id', left(e->>'id', 40), 'k', case when e->>'k' = 'own' then 'own' else 'fav' end)), '[]'::jsonb)
                                            from jsonb_array_elements(case when jsonb_typeof(p->'showcase') = 'array' then p->'showcase' else '[]'::jsonb end) e)
               else cur.showcase end,
    featured_deck = case when p ? 'featured_deck' then nullif(p->>'featured_deck', '') else cur.featured_deck end,
    inkwell_profile = case when p ? 'inkwell_profile' then nullif(p->>'inkwell_profile', '') else cur.inkwell_profile end,
    adult = case when p ? 'adult' then coalesce((p->>'adult')::boolean, false) else cur.adult end,
    is_public = case when p ? 'is_public' then coalesce((p->>'is_public')::boolean, false) else cur.is_public end,
    show_record = case when p ? 'show_record' then coalesce((p->>'show_record')::boolean, true) else cur.show_record end,
    show_trade = case when p ? 'show_trade' then coalesce((p->>'show_trade')::boolean, false) else cur.show_trade end,
    updated_at = now()
  where user_id = auth.uid();
  update public.profiles set is_public = false where user_id = auth.uid() and is_public and (handle is null or not adult or hidden_by_admin);
  return public.my_profile();
end $$;
revoke all on function public.save_my_profile(jsonb) from public, anon;
grant execute on function public.save_my_profile(jsonb) to authenticated;

-- ---------- recados ----------
create table if not exists public.recados (
  id uuid primary key default gen_random_uuid(),
  owner uuid not null references auth.users(id) on delete cascade,
  author uuid not null default auth.uid() references auth.users(id) on delete cascade,
  body text not null check (length(btrim(body)) between 1 and 500),
  status text not null default 'pending' check (status in ('pending', 'shown', 'hidden')),
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  check (owner <> author)
);
create index if not exists recados_owner on public.recados (owner, status, created_at desc);
alter table public.recados enable row level security;
drop policy if exists recados_read on public.recados;
create policy recados_read on public.recados for select to authenticated using ((select auth.uid()) in (owner, author));
drop policy if exists recados_owner_decides on public.recados;
create policy recados_owner_decides on public.recados for update to authenticated
  using (owner = (select auth.uid())) with check (owner = (select auth.uid()) and status in ('shown', 'hidden'));
drop policy if exists recados_delete on public.recados;
create policy recados_delete on public.recados for delete to authenticated using ((select auth.uid()) in (owner, author));
grant select, update (status, decided_at), delete on public.recados to authenticated;
-- writing goes through post_recado (friends, 18+, rate limit); no direct insert policy

create or replace function public.post_recado(p_handle text, p_body text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare t public.profiles; me public.profiles;
begin
  if auth.uid() is null then raise exception 'authentication_required' using errcode = '42501'; end if;
  select * into t from public.profiles where lower(handle) = lower(p_handle);
  select * into me from public.profiles where user_id = auth.uid();
  if t.user_id is null or t.user_id = auth.uid() then raise exception 'unknown profile'; end if;
  if not coalesce(me.adult, false) or not t.adult then raise exception 'adults_only'; end if;
  if not private.are_friends(auth.uid(), t.user_id) then raise exception 'friends_only'; end if;
  if length(btrim(coalesce(p_body, ''))) not between 1 and 500 then raise exception 'bad recado'; end if;
  if (select count(*) from public.recados where author = auth.uid() and created_at > now() - interval '1 day') >= 20 then raise exception 'too many recados'; end if;
  insert into public.recados (owner, author, body) values (t.user_id, auth.uid(), btrim(p_body));
  return jsonb_build_object('ok', true, 'status', 'pending');
end $$;
revoke all on function public.post_recado(text, text) from public, anon;
grant execute on function public.post_recado(text, text) to authenticated;

-- the owner's recados, with the authors' names (for approving)
create or replace function public.my_recados()
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', r.id, 'body', r.body, 'status', r.status, 'created_at', r.created_at,
           'author_name', a.display_name, 'author_handle', case when a.is_public and a.adult and not a.hidden_by_admin then a.handle end, 'author_avatar', a.avatar_card)
           order by (r.status = 'pending') desc, r.created_at desc), '[]'::jsonb)
    from public.recados r left join public.profiles a on a.user_id = r.author
   where r.owner = auth.uid() $$;
revoke all on function public.my_recados() from public, anon;
grant execute on function public.my_recados() to authenticated;

-- ---------- friendship requests from a profile, and invites that ask ----------
create or replace function public.request_friend(p_handle text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare t public.profiles;
begin
  if auth.uid() is null then raise exception 'authentication_required' using errcode = '42501'; end if;
  select * into t from public.profiles where lower(handle) = lower(p_handle) and is_public and adult and not hidden_by_admin and not is_mock;
  if t.user_id is null or t.user_id = auth.uid() then raise exception 'unknown profile'; end if;
  insert into public.friendships (requester, addressee) values (auth.uid(), t.user_id)
  on conflict ((least(requester, addressee)), (greatest(requester, addressee))) do nothing;
  return jsonb_build_object('ok', true);
end $$;
revoke all on function public.request_friend(text) from public, anon;
grant execute on function public.request_friend(text) to authenticated;

-- An invite now creates a friend request from the inviter; the person who signed in decides.
create or replace function public.accept_invite(p_code text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare inviter public.profiles; f public.friendships;
begin
  if auth.uid() is null then raise exception 'authentication_required' using errcode = '42501'; end if;
  select * into inviter from public.profiles where invite_code = p_code and not is_mock;
  if inviter.user_id is null then return jsonb_build_object('ok', false, 'reason', 'unknown'); end if;
  if inviter.user_id = auth.uid() then return jsonb_build_object('ok', false, 'reason', 'self'); end if;
  insert into public.friendships (requester, addressee) values (inviter.user_id, auth.uid())
  on conflict ((least(requester, addressee)), (greatest(requester, addressee))) do nothing;
  select * into f from public.friendships where least(requester, addressee) = least(inviter.user_id, auth.uid()) and greatest(requester, addressee) = greatest(inviter.user_id, auth.uid());
  return jsonb_build_object('ok', true, 'name', inviter.display_name, 'requester', f.requester, 'status', f.status);
end $$;
revoke all on function public.accept_invite(text) from public, anon;
grant execute on function public.accept_invite(text) to authenticated;

-- ---------- the public view, now with motto, friends, recados and how the viewer relates ----------
create or replace function public.public_profile(p_handle text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare p public.profiles; data jsonb; owned jsonb := '{}'::jsonb; deck jsonb; rec jsonb; trade jsonb; show jsonb := '[]'::jsonb; e jsonb;
        friends jsonb; friends_n int; recs jsonb; rel text := null; f public.friendships;
begin
  select * into p from public.profiles where lower(handle) = lower(p_handle);
  if p.user_id is null or not p.is_public or not p.adult or p.hidden_by_admin then return null; end if;
  select ip.data into data from public.inkwell_profiles ip where ip.user_id = p.user_id
   order by (ip.profile = p.inkwell_profile) desc, jsonb_array_length(coalesce(case when jsonb_typeof(ip.data->'decks') = 'array' then ip.data->'decks' end, '[]'::jsonb)) desc, ip.updated_at desc limit 1;
  if data is not null and jsonb_typeof(data->'collection') = 'object' then owned := data->'collection'; end if;
  for e in select * from jsonb_array_elements(p.showcase) loop
    show := show || jsonb_build_array(jsonb_build_object('id', e->>'id',
      'own', (e->>'k') = 'own' and coalesce((owned->(e->>'id')->>'n')::int, 0) + coalesce((owned->(e->>'id')->>'f')::int, 0) > 0));
  end loop;
  if p.featured_deck is not null and data is not null and jsonb_typeof(data->'decks') = 'array' then
    select jsonb_build_object('name', d->>'name', 'format', d->>'format', 'colors', d->'colors', 'cards', d->'cards') into deck
      from jsonb_array_elements(data->'decks') d where d->>'id' = p.featured_deck limit 1;
  end if;
  if p.show_record then
    select jsonb_build_object('w', count(*) filter (where g.summary->>'result' = 'win'), 'l', count(*) filter (where g.summary->>'result' = 'loss'))
      into rec from public.game_logs g where g.user_id = p.user_id;
  end if;
  if p.show_trade then
    trade := jsonb_build_object(
      'want', coalesce((select jsonb_agg(k) from (select k from jsonb_object_keys(case when jsonb_typeof(data->'wishlist') = 'object' then data->'wishlist' else '{}'::jsonb end) k limit 12) x), '[]'::jsonb)
              || coalesce((select jsonb_agg(distinct l.card_id) from public.listings l where l.user_id = p.user_id and l.kind in ('buy', 'borrow')), '[]'::jsonb),
      'have', coalesce((select jsonb_agg(distinct l.card_id) from public.listings l where l.user_id = p.user_id and l.kind in ('sell', 'lend')), '[]'::jsonb));
  end if;
  -- friends: only those who have a public profile themselves are named; the rest only count
  select count(*) into friends_n from public.friendships fr where fr.status = 'accepted' and p.user_id in (fr.requester, fr.addressee);
  select coalesce(jsonb_agg(jsonb_build_object('name', o.display_name, 'handle', o.handle, 'avatar', o.avatar_card) order by fr.accepted_at desc nulls last), '[]'::jsonb) into friends
    from public.friendships fr join public.profiles o on o.user_id = case when fr.requester = p.user_id then fr.addressee else fr.requester end
   where fr.status = 'accepted' and p.user_id in (fr.requester, fr.addressee) and o.is_public and o.adult and not o.hidden_by_admin and o.handle is not null;
  select coalesce(jsonb_agg(x), '[]'::jsonb) into recs from (
    select jsonb_build_object('id', r.id, 'body', r.body, 'at', r.created_at, 'name', a.display_name,
             'handle', case when a.is_public and a.adult and not a.hidden_by_admin then a.handle end,
             'avatar', case when a.is_public and a.adult and not a.hidden_by_admin then a.avatar_card end) x
      from public.recados r join public.profiles a on a.user_id = r.author
     where r.owner = p.user_id and r.status = 'shown' and not a.hidden_by_admin
     order by r.created_at desc limit 20) y;
  if auth.uid() is not null then
    if auth.uid() = p.user_id then rel := 'self';
    else
      select * into f from public.friendships where least(requester, addressee) = least(auth.uid(), p.user_id) and greatest(requester, addressee) = greatest(auth.uid(), p.user_id);
      rel := case when f.requester is null then 'none' when f.status = 'accepted' then 'friend' when f.requester = auth.uid() then 'asked' else 'asks_you' end;
    end if;
  end if;
  return jsonb_build_object('handle', p.handle, 'name', p.display_name, 'bio', p.bio, 'motto', p.motto, 'avatar', p.avatar_card, 'inks', to_jsonb(p.inks),
    'city', p.city, 'showcase', show, 'deck', deck, 'record', rec, 'trade', trade, 'mock', p.is_mock,
    'friends', friends, 'friends_n', friends_n, 'recados', recs, 'relation', rel,
    'can_recado', rel = 'friend' and coalesce((select adult from public.profiles where user_id = auth.uid()), false));
end $$;
revoke all on function public.public_profile(text) from public;
grant execute on function public.public_profile(text) to anon, authenticated;

-- ---------- named example profiles (fictional; delete in the admin panel) ----------
do $$
declare u1 uuid := '00000000-0000-4000-a000-000000000001'; u2 uuid := '00000000-0000-4000-a000-000000000002'; u3 uuid := '00000000-0000-4000-a000-000000000003';
begin
  insert into auth.users (instance_id, id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  values ('00000000-0000-0000-0000-000000000000', u1, 'authenticated', 'authenticated', 'rafa@exemplo.invalid', '{"provider":"email","providers":["email"],"mock":true}', '{}', now(), now()),
         ('00000000-0000-0000-0000-000000000000', u2, 'authenticated', 'authenticated', 'marina@exemplo.invalid', '{"provider":"email","providers":["email"],"mock":true}', '{}', now(), now()),
         ('00000000-0000-0000-0000-000000000000', u3, 'authenticated', 'authenticated', 'bia@exemplo.invalid', '{"provider":"email","providers":["email"],"mock":true}', '{}', now(), now())
  on conflict (id) do update set email = excluded.email;

  insert into public.profiles (user_id, display_name, handle, bio, motto, avatar_card, inks, city, showcase, featured_deck, inkwell_profile, is_public, adult, show_record, show_trade, is_mock)
  values (u1, 'Rafa (exemplo)', 'rafa_exemplo', 'Jogo Âmbar/Aço competitivo e testo listas toda semana. Topo um BO3 a qualquer hora.', 'Quinta é dia de liga.',
          'LOR12-239', array['Amber','Steel'], 'São Paulo', '[{"id":"LOR12-239","k":"fav"},{"id":"LOR10-178","k":"own"},{"id":"LOR10-10","k":"own"}]', 'mock-deck-1', 'user1', true, true, true, true, true),
         (u2, 'Marina (exemplo)', 'marina_exemplo', 'Coleciono Encantadas de Ametista e Safira. Troco repetidas por cartas da minha lista.', 'Uma Encantada de cada vez.',
          'LOR13-234', array['Amethyst','Sapphire'], 'Rio de Janeiro', '[{"id":"LOR13-234","k":"own"},{"id":"LOR12-236","k":"own"},{"id":"LOR13-231","k":"fav"}]', null, 'user2', true, true, false, true, true),
         (u3, 'Bia (exemplo)', 'bia_exemplo', 'Comecei no set 10 com amigos da loja. Jogo Esmeralda/Rubi sem pressa e adoro decks temáticos.', 'Venho pelo jogo, fico pelas pessoas.',
          'LOR13-236', array['Emerald','Ruby'], 'Campinas', '[{"id":"LOR13-237","k":"fav"},{"id":"LOR10-106","k":"own"},{"id":"LOR10-100","k":"own"}]', 'mock-deck-3', 'user3', true, true, true, false, true)
  on conflict (user_id) do update set display_name = excluded.display_name, handle = excluded.handle, bio = excluded.bio, motto = excluded.motto, avatar_card = excluded.avatar_card,
    inks = excluded.inks, city = excluded.city, showcase = excluded.showcase, featured_deck = excluded.featured_deck, inkwell_profile = excluded.inkwell_profile,
    is_public = true, adult = true, show_record = excluded.show_record, show_trade = excluded.show_trade, is_mock = true;

  delete from public.inkwell_profiles where user_id in (u1, u2, u3);
  insert into public.inkwell_profiles (user_id, profile, data, schema, updated_at, revision) values
   (u1, 'user1', jsonb_build_object('mock', true,
      'collection', '{"LOR10-178":{"n":4,"f":0},"LOR10-10":{"n":4,"f":1}}'::jsonb,
      'wishlist', '{"LOR12-239":1,"LOR14-2":1}'::jsonb,
      'decks', jsonb_build_array(jsonb_build_object('id', 'mock-deck-1', 'name', 'Âmbar/Aço da liga', 'format', 'core', 'colors', jsonb_build_array('Amber', 'Steel'),
        'cards', '{"LOR10-178":4,"LOR10-10":4,"LOR10-12":4,"LOR10-11":4,"LOR10-15":4,"LOR10-1":4,"LOR10-189":4,"LOR10-195":4,"LOR10-16":4,"LOR10-13":4,"LOR10-17":4,"LOR10-187":4,"LOR10-173":4,"LOR10-20":4,"LOR10-199":4}'::jsonb))), 1, now(), 1),
   (u2, 'user2', jsonb_build_object('mock', true, 'collection', '{"LOR13-234":{"n":0,"f":1},"LOR12-236":{"n":0,"f":1}}'::jsonb,
      'wishlist', '{"LOR13-231":1,"LOR12-227":1,"LOR13-235":1}'::jsonb, 'decks', '[]'::jsonb), 1, now(), 1),
   (u3, 'user3', jsonb_build_object('mock', true, 'collection', '{"LOR10-106":{"n":2,"f":0},"LOR10-100":{"n":3,"f":0}}'::jsonb, 'wishlist', '{}'::jsonb,
      'decks', jsonb_build_array(jsonb_build_object('id', 'mock-deck-3', 'name', 'Esmeralda/Rubi de sexta', 'format', 'core', 'colors', jsonb_build_array('Emerald', 'Ruby'),
        'cards', '{"LOR10-106":4,"LOR10-100":4,"LOR10-105":4,"LOR10-111":4,"LOR10-115":4,"LOR10-109":4,"LOR10-77":4,"LOR10-110":4,"LOR10-101":4,"LOR10-107":4,"LOR10-118":4,"LOR10-124":4,"LOR10-116":4,"LOR10-79":4,"LOR10-130":4}'::jsonb))), 1, now(), 1);

  -- invented records (summaries only, private: never in any feed)
  delete from public.game_logs where user_id in (u1, u2, u3) and game_id like 'mock-%';
  insert into public.game_logs (user_id, game_id, source, played_at, log, visibility)
  select u, 'mock-' || g, 'manual', now() - (g || ' days')::interval, '{"mock":true}'::jsonb, 'private'
    from (values (u1, 25), (u3, 12)) v(u, n), generate_series(1, n) g;
  update public.game_logs set visibility = 'private',
         summary = jsonb_build_object('result', case when (user_id = u1 and split_part(game_id, '-', 2)::int % 4 = 0)
                                                  or (user_id = u3 and split_part(game_id, '-', 2)::int % 2 = 0) then 'loss' else 'win' end, 'mock', true)
   where user_id in (u1, u3) and game_id like 'mock-%';

  -- they know each other
  insert into public.friendships (requester, addressee, status, accepted_at) values
    (u1, u2, 'accepted', now() - interval '20 days'), (u2, u3, 'accepted', now() - interval '9 days'), (u1, u3, 'accepted', now() - interval '3 days')
  on conflict ((least(requester, addressee)), (greatest(requester, addressee))) do update set status = 'accepted';

  delete from public.recados where owner in (u1, u2, u3);
  insert into public.recados (owner, author, body, status, created_at, decided_at) values
    (u1, u2, 'Valeu pela troca da Mulan! Quinta tem revanche.', 'shown', now() - interval '2 days', now()),
    (u1, u3, 'Me ensina aquele turno 4 de novo? 😅', 'shown', now() - interval '1 day', now()),
    (u2, u1, 'Achei a Kida Encantada que você procurava, separei pra você.', 'shown', now() - interval '5 days', now()),
    (u3, u2, 'Bem-vinda ao grupo! Sexta tem torneio casual na loja.', 'shown', now() - interval '8 days', now());
end $$;
