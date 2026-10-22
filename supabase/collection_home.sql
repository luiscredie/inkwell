-- Where the cards are: the collection (inkwell_profiles.data.collection) is everything you own; this table says how
-- many of those are at home ("Casa"). The binder ("Fichário") is the rest, minus what is lent out.
-- Your cards today are all in the binder: nothing to move. Run after collection_added.sql (safe to run again).
create table if not exists public.collection_home (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  profile text not null,
  card_id text not null check (length(card_id) between 1 and 40),
  n int not null default 0 check (n >= 0),
  f int not null default 0 check (f >= 0),
  updated_at timestamptz not null default now(),
  primary key (user_id, profile, card_id)
);
alter table public.collection_home enable row level security;
drop policy if exists "owners read their home cards" on public.collection_home;
create policy "owners read their home cards" on public.collection_home for select to authenticated using ((select auth.uid()) = user_id);
revoke all on public.collection_home from anon, authenticated;
grant select on public.collection_home to authenticated;   -- changes only through collection_change()

-- One call for any change: p_delta changes what you own (as apply_collection_delta), p_home changes how many are at
-- home. Adding to Casa = both; moving between Fichário and Casa = p_home only. Never more at home than you own.
create or replace function public.collection_change(p_profile text, p_delta jsonb, p_home jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare u uuid := auth.uid(); e jsonb; k text; ids text[] := '{}'; bad text;
begin
  if u is null then raise exception 'authentication_required' using errcode = '42501'; end if;
  p_delta := coalesce(p_delta, '[]'); p_home := coalesce(p_home, '[]');
  if jsonb_typeof(p_home) <> 'array' or jsonb_array_length(p_home) > 400 then raise exception 'bad home'; end if;
  if jsonb_array_length(p_delta) > 0 then perform public.apply_collection_delta(p_profile, p_delta); end if;
  for e in select * from jsonb_array_elements(p_home) loop
    if coalesce(e->>'card_id', '') = '' or length(e->>'card_id') > 40 or jsonb_typeof(e->'qty') <> 'number' then raise exception 'bad home item'; end if;
    k := case when coalesce((e->>'foil')::boolean, false) then 'f' else 'n' end;
    insert into public.collection_home as h (user_id, profile, card_id, n, f)
      values (u, p_profile, e->>'card_id', case when k = 'n' then (e->>'qty')::int else 0 end, case when k = 'f' then (e->>'qty')::int else 0 end)
      on conflict (user_id, profile, card_id) do update
        set n = h.n + case when k = 'n' then (e->>'qty')::int else 0 end,
            f = h.f + case when k = 'f' then (e->>'qty')::int else 0 end, updated_at = now();
    ids := ids || (e->>'card_id');
  end loop;
  ids := ids || array(select x->>'card_id' from jsonb_array_elements(p_delta) x);
  -- never more at home than owned (this also catches a negative count: the check constraint fails first)
  select h.card_id into bad from public.collection_home h
    join public.inkwell_profiles p on p.user_id = h.user_id and p.profile = h.profile
   where h.user_id = u and h.profile = p_profile and h.card_id = any(ids)
     and (h.n > coalesce((p.data->'collection'->h.card_id->>'n')::int, 0) or h.f > coalesce((p.data->'collection'->h.card_id->>'f')::int, 0))
   limit 1;
  if bad is not null then raise exception 'more at home than owned: %', bad; end if;
  delete from public.collection_home where user_id = u and profile = p_profile and card_id = any(ids) and n = 0 and f = 0;
end $$;
revoke all on function public.collection_change(text, jsonb, jsonb) from public, anon;
grant execute on function public.collection_change(text, jsonb, jsonb) to authenticated;

-- "Baixar meus dados" includes the cards at home (same as my_account.sql).
create or replace function public.my_data_export()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare u uuid := auth.uid();
begin
  if u is null then raise exception 'authentication_required' using errcode = '42501'; end if;
  return jsonb_build_object(
    'exported_at', now(), 'about', 'Inkwell: todos os dados ligados à sua conta / all data linked to your account',
    'account', (select jsonb_build_object('id', id, 'email', email, 'created_at', created_at, 'last_sign_in_at', last_sign_in_at) from auth.users where id = u),
    'profile', (select to_jsonb(p) from public.profiles p where p.user_id = u),
    'inkwell', coalesce((select jsonb_agg(to_jsonb(x)) from public.inkwell_profiles x where x.user_id = u), '[]'),
    'games', coalesce((select jsonb_agg(to_jsonb(x)) from public.game_logs x where x.user_id = u), '[]'),
    'game_notes', coalesce((select jsonb_agg(to_jsonb(x)) from public.game_notes x where x.author = u), '[]'),
    'friendships', coalesce((select jsonb_agg(to_jsonb(x)) from public.friendships x where u in (x.requester, x.addressee)), '[]'),
    'friend_groups', coalesce((select jsonb_agg(to_jsonb(x)) from public.friend_groups x where x.owner_id = u), '[]'),
    'coach_groups', coalesce((select jsonb_agg(to_jsonb(x)) from public.coach_groups x where x.owner_id = u), '[]'),
    'coach_links', coalesce((select jsonb_agg(to_jsonb(x)) from public.coach_links x where x.owner_id = u), '[]'),
    'listings', coalesce((select jsonb_agg(to_jsonb(x)) from public.listings x where x.user_id = u), '[]'),
    'loans', coalesce((select jsonb_agg(to_jsonb(x)) from public.loans x where x.user_id = u), '[]'),
    'trades', coalesce((select jsonb_agg(to_jsonb(x)) from public.trades x where x.user_id = u), '[]'),
    'loans_with_friends', coalesce((select jsonb_agg(to_jsonb(x)) from public.user_loans x where u in (x.lender, x.borrower)), '[]'),
    'trades_with_friends', coalesce((select jsonb_agg(to_jsonb(x)) from public.user_trades x where u in (x.proposer, x.partner)), '[]'),
    'collection_dates', coalesce((select jsonb_agg(to_jsonb(x)) from public.collection_added x where x.user_id = u), '[]'),
    'cards_at_home', coalesce((select jsonb_agg(to_jsonb(x)) from public.collection_home x where x.user_id = u), '[]'),
    'recados_received', coalesce((select jsonb_agg(to_jsonb(x)) from public.recados x where x.owner = u), '[]'),
    'recados_written', coalesce((select jsonb_agg(to_jsonb(x)) from public.recados x where x.author = u), '[]'),
    'communities', coalesce((select jsonb_agg(jsonb_build_object('community', c.name, 'slug', c.slug, 'role', m.role, 'joined_at', m.joined_at))
                               from public.community_members m join public.communities c on c.id = m.community_id where m.user_id = u), '[]'),
    'community_posts', coalesce((select jsonb_agg(to_jsonb(x)) from public.community_posts x where x.author = u), '[]'),
    'reports_sent', coalesce((select jsonb_agg(jsonb_build_object('reason', x.reason, 'status', x.status, 'created_at', x.created_at)) from public.reports x where x.reporter = u), '[]'));
end $$;
revoke all on function public.my_data_export() from public, anon;
grant execute on function public.my_data_export() to authenticated;
