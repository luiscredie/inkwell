-- Push notifications on the phone/computer.
--  * push_subs: the devices where someone
--    turned the notices on (one row each).
--  * every new row in notifications calls the
--    push-send function, which reads what to
--    send through push_payload() with a key
--    kept in the vault (only it knows the key).
-- Run after social.sql. Needs pg_net (already
-- on for duels-sync).

create table if not exists public.push_subs (
  endpoint text primary key
    check (length(endpoint) <= 600
      and endpoint ~ '^https://'),
  user_id uuid not null
    references auth.users(id)
    on delete cascade,
  p256dh text not null
    check (length(p256dh) <= 200),
  auth text not null
    check (length(auth) <= 100),
  ua text check (length(ua) <= 200),
  created_at timestamptz not null
    default now());
create index if not exists push_subs_user
  on public.push_subs (user_id);
alter table public.push_subs
  enable row level security;

-- the key push-send must present
select vault.create_secret(
  encode(extensions.gen_random_bytes(24),
    'hex'), 'push_key',
  'Key push-send uses to read notices')
 where not exists (
   select 1 from vault.secrets
    where name = 'push_key');

-- the VAPID private key (the pair's public
-- half is in src/site/shell.js). The copy of
-- this file in the repo has a placeholder; the
-- real key is never committed.
select vault.create_secret(
  'VAPID-PRIVATE-KEY-HERE',
  'vapid_private',
  'Signs push messages (push-send)')
 where not exists (
   select 1 from vault.secrets
    where name = 'vapid_private');

create or replace function
  private.push_key()
returns text
language sql stable security definer
set search_path = '' as $$
  select decrypted_secret
    from vault.decrypted_secrets
   where name = 'push_key';
$$;

-- turn on / off on this device
create or replace function
  public.save_push_sub(
    p_endpoint text, p_p256dh text,
    p_auth text, p_ua text default null)
returns void
language plpgsql security definer
set search_path = '' as $$
begin
  if auth.uid() is null then
    raise exception 'authentication_required'
      using errcode = '42501';
  end if;
  insert into public.push_subs
    (endpoint, user_id, p256dh, auth, ua)
  values (p_endpoint, auth.uid(), p_p256dh,
    p_auth, left(p_ua, 200))
  on conflict (endpoint) do update
    set user_id = excluded.user_id,
        p256dh = excluded.p256dh,
        auth = excluded.auth,
        ua = excluded.ua,
        created_at = now();
end $$;

create or replace function
  public.delete_push_sub(p_endpoint text)
returns void
language sql security definer
set search_path = '' as $$
  delete from public.push_subs
   where endpoint = p_endpoint
     and user_id = auth.uid();
$$;

-- for push-send: what to say and where
create or replace function
  public.push_payload(p_id uuid, p_key text)
returns jsonb
language plpgsql stable security definer
set search_path = '' as $$
declare n public.notifications; t text;
begin
  if p_key is null
     or p_key <> private.push_key() then
    raise exception 'not allowed'
      using errcode = '42501';
  end if;
  select * into n
    from public.notifications where id = p_id;
  if n.id is null then return null; end if;
  t := coalesce(n.ref->>'text', (
    select left(p.body, 80)
      from public.posts p
     where p.id::text = n.ref->>'post'), (
    select e.title from public.events e
     where e.id::text = n.ref->>'event'));
  return jsonb_build_object(
    'kind', n.kind, 'ref', n.ref,
    'text', t,
    'vapid', (select decrypted_secret
      from vault.decrypted_secrets
     where name = 'vapid_private'),
    'actor', (select display_name
      from public.profiles
     where user_id = n.actor),
    'unread', (select count(*)
      from public.notifications x
     where x.user_id = n.user_id
       and x.read_at is null),
    'subs', coalesce((
      select jsonb_agg(jsonb_build_object(
        'endpoint', s.endpoint,
        'p256dh', s.p256dh,
        'auth', s.auth))
        from public.push_subs s
       where s.user_id = n.user_id),
      '[]'::jsonb));
end $$;

-- push-send: the device said "gone"
create or replace function
  public.push_gone(
    p_endpoint text, p_key text)
returns void
language plpgsql security definer
set search_path = '' as $$
begin
  if p_key is null
     or p_key <> private.push_key() then
    raise exception 'not allowed'
      using errcode = '42501';
  end if;
  delete from public.push_subs
   where endpoint = p_endpoint;
end $$;

-- each new notice -> push-send (only for
-- people with a device turned on)
create or replace function
  private.push_notify()
returns trigger
language plpgsql security definer
set search_path = '' as $$
begin
  if exists (select 1
       from public.push_subs
      where user_id = new.user_id) then
    perform net.http_post(
      url := 'https://sorefaetiaebmjploanp'
        || '.supabase.co/functions/v1/'
        || 'push-send',
      body := jsonb_build_object(
        'id', new.id),
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-push-key', private.push_key()));
  end if;
  return new;
end $$;

drop trigger if exists notifications_push
  on public.notifications;
create trigger notifications_push
  after insert on public.notifications
  for each row
  execute function private.push_notify();

revoke all on function
  public.save_push_sub(text, text, text,
    text) from public, anon;
grant execute on function
  public.save_push_sub(text, text, text,
    text) to authenticated;
revoke all on function
  public.delete_push_sub(text)
  from public, anon;
grant execute on function
  public.delete_push_sub(text)
  to authenticated;
revoke all on function
  public.push_payload(uuid, text) from public;
grant execute on function
  public.push_payload(uuid, text)
  to anon, authenticated;
revoke all on function
  public.push_gone(text, text) from public;
grant execute on function
  public.push_gone(text, text)
  to anon, authenticated;
