-- Your data (LGPD art. 18): download everything, delete the account. And the signed-in home's "Para você".
-- Run after communities.sql (safe to run again).

-- ---------- download my data ----------
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
    'recados_received', coalesce((select jsonb_agg(to_jsonb(x)) from public.recados x where x.owner = u), '[]'),
    'recados_written', coalesce((select jsonb_agg(to_jsonb(x)) from public.recados x where x.author = u), '[]'),
    'communities', coalesce((select jsonb_agg(jsonb_build_object('community', c.name, 'slug', c.slug, 'role', m.role, 'joined_at', m.joined_at))
                               from public.community_members m join public.communities c on c.id = m.community_id where m.user_id = u), '[]'),
    'community_posts', coalesce((select jsonb_agg(to_jsonb(x)) from public.community_posts x where x.author = u), '[]'),
    'reports_sent', coalesce((select jsonb_agg(jsonb_build_object('reason', x.reason, 'status', x.status, 'created_at', x.created_at)) from public.reports x where x.reporter = u), '[]'));
end $$;
revoke all on function public.my_data_export() from public, anon;
grant execute on function public.my_data_export() to authenticated;

-- ---------- delete my account ----------
-- Everything linked to the account goes with it (on delete cascade). Communities you own pass to
-- their longest-standing member, or are deleted when nobody else is in them.
create or replace function public.delete_my_account(p_confirm text)
returns void language plpgsql security definer set search_path = '' as $$
declare u uuid := auth.uid(); c record; heir uuid;
begin
  if u is null then raise exception 'authentication_required' using errcode = '42501'; end if;
  if upper(btrim(coalesce(p_confirm, ''))) not in ('EXCLUIR', 'DELETE') then raise exception 'confirmation_required'; end if;
  if exists (select 1 from public.admins where user_id = u) and (select count(*) from public.admins) = 1 then raise exception 'last_admin'; end if;
  for c in select community_id from public.community_members where user_id = u and role = 'owner' loop
    select user_id into heir from public.community_members where community_id = c.community_id and user_id <> u order by joined_at limit 1;
    if heir is null then delete from public.communities where id = c.community_id;
    else update public.community_members set role = 'owner' where community_id = c.community_id and user_id = heir; heir := null;
    end if;
  end loop;
  delete from public.inkwell_profiles where user_id = u;
  delete from auth.users where id = u;
end $$;
revoke all on function public.delete_my_account(text) from public, anon;
grant execute on function public.delete_my_account(text) to authenticated;

-- ---------- the signed-in home: what is waiting for you ----------
create or replace function public.my_home()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare u uuid := auth.uid(); p public.profiles;
begin
  if u is null then return null; end if;
  select * into p from public.profiles where user_id = u;
  return jsonb_build_object(
    'profile', jsonb_build_object('handle', p.handle, 'is_public', coalesce(p.is_public, false), 'adult', coalesce(p.adult, false), 'avatar', p.avatar_card, 'motto', p.motto),
    'friend_requests', coalesce((select jsonb_agg(private.face(f.requester) order by f.created_at desc) from public.friendships f where f.addressee = u and f.status = 'pending'), '[]'),
    'recados_waiting', (select count(*) from public.recados r where r.owner = u and r.status = 'pending'),
    'recados_new', coalesce((select jsonb_agg(y.x) from (select private.face(r.author) || jsonb_build_object('body', r.body, 'at', r.created_at) x
                      from public.recados r where r.owner = u and r.status = 'shown' and r.created_at > now() - interval '14 days' order by r.created_at desc limit 3) y), '[]'),
    'communities', coalesce((select jsonb_agg(jsonb_build_object('slug', c.slug, 'name', c.name, 'avatar', c.avatar_card, 'mock', c.is_mock) order by m.joined_at)
                      from public.community_members m join public.communities c on c.id = m.community_id where m.user_id = u and not c.hidden), '[]'),
    'community_posts', coalesce((select jsonb_agg(y.x) from (
        select coalesce(private.face(cp.author), jsonb_build_object('name', null)) || jsonb_build_object('body', cp.body, 'at', cp.created_at, 'community', c.name, 'slug', c.slug, 'mine', cp.author = u) x
          from public.community_posts cp join public.communities c on c.id = cp.community_id
          join public.community_members m on m.community_id = c.id and m.user_id = u
         where not cp.hidden and not c.hidden order by cp.created_at desc limit 6) y), '[]'));
end $$;
revoke all on function public.my_home() from public, anon;
grant execute on function public.my_home() to authenticated;
