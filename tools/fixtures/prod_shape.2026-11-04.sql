
create schema auth; create schema private;
revoke all on schema private from public; grant usage on schema private to authenticated;
create table auth.users (id uuid primary key, email text, created_at timestamptz default now());
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('t.uid', true), '')::uuid $$;
grant usage on schema auth to anon, authenticated; grant execute on function auth.uid() to public;
create table public.admins (user_id uuid primary key, added_at timestamptz default now());
create table private.page_events (id bigint generated always as identity primary key, at timestamptz not null default now(), sid text, page text, kind text, name text, signed boolean, ref text, dev text);
create table public.profiles (user_id uuid primary key, display_name text, updated_at timestamptz, default_visibility text, default_group_id uuid, default_coach_email text, default_coach_group_id uuid, auto_collection boolean, handle text, bio text, avatar_card text, inks text[], city text, showcase jsonb, featured_deck text, inkwell_profile text, is_public boolean, adult boolean, show_record boolean, show_trade boolean, invite_code text, is_mock boolean, hidden_by_admin boolean, motto text, cover_card text);
create table public.inkwell_profiles (user_id uuid, profile text, data jsonb, schema integer, updated_at timestamptz, revision bigint);
create table public.collection_shares (owner uuid, profile text, member uuid, can_edit boolean, created_at timestamptz);
create table public.collection_share_invites (code text, owner uuid, profile text, can_edit boolean, created_at timestamptz, expires_at timestamptz, used_by uuid, used_at timestamptz);
create table public.collection_privacy (user_id uuid, profile text, friends_view boolean, friends_lend boolean, updated_at timestamptz);
create table public.collection_trade (user_id uuid, profile text, card_id text, n integer, f integer, updated_at timestamptz);
create table public.collection_decked (user_id uuid, profile text, deck_id text, deck_name text, built_by uuid, card_id text, n integer, f integer, updated_at timestamptz);
create table public.achievements (id uuid, user_id uuid, kind text, title text, body text, happened_on date, place text, image text, visibility text, hidden boolean, created_at timestamptz, rph_id bigint, rph_name text, rph_store text);
create table public.comment_likes (comment_id uuid, user_id uuid, created_at timestamptz);
create table private.feedback (id uuid, created_at timestamptz, user_id uuid, kind text, body text, page text, path text, device text, email text, status text, done_at timestamptz);
create function private.my_data_export_base() returns jsonb language sql stable security definer set search_path = '' as $$ select '{"base": true}'::jsonb $$;
CREATE OR REPLACE FUNCTION private.is_admin()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select exists (select 1 from public.admins where user_id = auth.uid()) $function$
;
CREATE OR REPLACE FUNCTION public.track(p_sid text, p_page text, p_kind text, p_name text, p_ref text, p_dev text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if p_sid !~ '^[a-f0-9]{16,40}$'
     or p_page !~ '^[a-z_-]{1,20}$'
     or p_kind not in ('view', 'action')
     or (p_kind = 'action'
       and coalesce(p_name, '')
         !~ '^[a-z_]{1,30}$')
     or private.is_admin() then
    return;
  end if;
  -- a runaway tab stops counting
  if (select count(*)
        from private.page_events
       where sid = p_sid
         and at > now() - interval '1 day')
     >= 400 then
    return;
  end if;
  insert into private.page_events
    (sid, page, kind, name, signed, ref, dev)
  values (p_sid, p_page, p_kind,
    case when p_kind = 'action'
      then p_name end,
    auth.uid() is not null,
    case when p_ref ~ '^[a-z0-9.-]{3,60}$'
      then p_ref end,
    case when p_dev in ('mobile', 'desktop')
      then p_dev end);
end $function$
;
CREATE OR REPLACE FUNCTION private.trim_page_events()
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
  delete from private.page_events
   where at < now() - interval '90 days';
$function$
;
CREATE OR REPLACE FUNCTION public.my_data_export()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare u uuid := auth.uid();
begin
  return private.my_data_export_base()
    || jsonb_build_object(
    'collection_shares', coalesce((
      select jsonb_agg(to_jsonb(x))
        from public.collection_shares x
       where u in (x.owner, x.member)),
      '[]'),
    'collection_share_links', coalesce((
      select jsonb_agg(to_jsonb(x))
        from public.collection_share_invites x
       where x.owner = u), '[]'),
    'collection_privacy', (
      select to_jsonb(x)
        from public.collection_privacy x
       where x.user_id = u),
    'cards_in_trade_binder', coalesce((
      select jsonb_agg(to_jsonb(x))
        from public.collection_trade x
       where x.user_id = u), '[]'),
    'cards_in_built_decks', coalesce((
      select jsonb_agg(to_jsonb(x))
        from public.collection_decked x
       where x.user_id = u), '[]'),
    'achievements', coalesce((
      select jsonb_agg(to_jsonb(x))
        from public.achievements x
       where x.user_id = u), '[]'),
    'comment_likes', coalesce((
      select jsonb_agg(to_jsonb(x))
        from public.comment_likes x
       where x.user_id = u), '[]'),
    'feedback_sent', coalesce((
      select jsonb_agg(jsonb_build_object('kind', x.kind, 'body', x.body, 'at', x.created_at))
        from private.feedback x
       where x.user_id = u), '[]'));
end $function$
;

revoke all on function public.my_data_export() from public;
grant execute on function public.my_data_export() to authenticated, service_role;
revoke all on function public.track(text,text,text,text,text,text) from public;
grant execute on function public.track(text,text,text,text,text,text) to anon, authenticated, service_role;
