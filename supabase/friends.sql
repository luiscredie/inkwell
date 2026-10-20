-- Friends, the "friends" visibility level and each player's default for new games.
-- Run after community.sql and hide_names.sql (safe to run again).
create table if not exists public.friendships (
  requester uuid not null default auth.uid() references auth.users(id) on delete cascade,
  addressee uuid not null references auth.users(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'accepted')),
  created_at timestamptz not null default now(),
  accepted_at timestamptz,
  primary key (requester, addressee),
  check (requester <> addressee)
);
create unique index if not exists friendships_pair on public.friendships (least(requester, addressee), greatest(requester, addressee));
alter table public.friendships enable row level security;
drop policy if exists "both people see the friendship" on public.friendships;
create policy "both people see the friendship" on public.friendships for select to authenticated
  using ((select auth.uid()) in (requester, addressee));
drop policy if exists "ask to be friends" on public.friendships;
create policy "ask to be friends" on public.friendships for insert to authenticated
  with check (requester = (select auth.uid()) and status = 'pending' and accepted_at is null);
drop policy if exists "the other person accepts" on public.friendships;
create policy "the other person accepts" on public.friendships for update to authenticated
  using (addressee = (select auth.uid())) with check (addressee = (select auth.uid()) and status = 'accepted');
drop policy if exists "either person ends it" on public.friendships;
create policy "either person ends it" on public.friendships for delete to authenticated
  using ((select auth.uid()) in (requester, addressee));
grant select, insert, update, delete on public.friendships to authenticated;

create or replace function private.are_friends(a uuid, b uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.friendships f where f.status = 'accepted'
    and ((f.requester = a and f.addressee = b) or (f.requester = b and f.addressee = a)));
$$;
revoke all on function private.are_friends(uuid, uuid) from public, anon;
grant execute on function private.are_friends(uuid, uuid) to authenticated;

alter table public.game_logs drop constraint if exists game_logs_visibility_check;
alter table public.game_logs add constraint game_logs_visibility_check check (visibility in ('private', 'friends', 'public'));

alter policy "readers see game logs" on public.game_logs
  using (
    (select auth.uid()) = user_id
    or visibility = 'public'
    or (visibility = 'friends' and (select private.are_friends(user_id, (select auth.uid()))))
    or exists (select 1 from public.coach_links c where c.owner_id = game_logs.user_id and c.coach_email = lower((select auth.jwt() ->> 'email')))
  );

create or replace function private.can_read_game(p_owner uuid, p_game text) returns boolean
language sql stable security definer set search_path = '' as $$
  select p_owner = (select auth.uid())
      or exists (select 1 from public.game_logs g where g.user_id = p_owner and g.game_id = p_game
                 and (g.visibility = 'public' or (g.visibility = 'friends' and private.are_friends(p_owner, (select auth.uid())))))
      or exists (select 1 from public.coach_links c where c.owner_id = p_owner and c.coach_email = lower((select auth.jwt() ->> 'email')));
$$;

alter table public.profiles add column if not exists default_visibility text not null default 'private'
  check (default_visibility in ('private', 'friends', 'public'));

create or replace function private.game_logs_default_visibility() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.visibility = 'private' then
    select coalesce(p.default_visibility, 'private') into new.visibility from public.profiles p where p.user_id = new.user_id;
    new.visibility := coalesce(new.visibility, 'private');
  end if;
  return new;
end $$;
revoke all on function private.game_logs_default_visibility() from public, anon, authenticated;
drop trigger if exists game_logs_a_default_visibility on public.game_logs;
create trigger game_logs_a_default_visibility before insert on public.game_logs
  for each row execute function private.game_logs_default_visibility();

create index if not exists game_logs_feed on public.game_logs (user_id, played_at desc) where visibility <> 'private';

-- Opponents' names are hidden for friends too, not only for public games.
create or replace function private.game_logs_hide_names() returns trigger
language plpgsql security definer set search_path = '' as $$
declare saved jsonb;
begin
  if new.visibility <> 'private' then
    select jsonb_object_agg(p->>'seat', p->'name') into saved
      from jsonb_array_elements(coalesce(new.log->'players', '[]')) p
      where coalesce(p->>'is_me', 'false') <> 'true' and coalesce(p->>'name', '') not in ('', 'Opponent');
    if saved is not null then
      insert into private.hidden_names (user_id, game_id, names) values (new.user_id, new.game_id, saved)
        on conflict (user_id, game_id) do update set names = private.hidden_names.names || excluded.names;
    end if;
    new.log := jsonb_set(new.log, '{players}', coalesce((
      select jsonb_agg(case when coalesce(p->>'is_me', 'false') = 'true' then p else jsonb_set(p, '{name}', '"Opponent"') end order by ord)
      from jsonb_array_elements(coalesce(new.log->'players', '[]')) with ordinality x(p, ord)), '[]'::jsonb));
  elsif tg_op = 'UPDATE' and old.visibility <> 'private' and new.visibility = 'private' then
    select names into saved from private.hidden_names where user_id = new.user_id and game_id = new.game_id;
    if saved is not null then
      new.log := jsonb_set(new.log, '{players}', coalesce((
        select jsonb_agg(case when saved ? (p->>'seat') then jsonb_set(p, '{name}', saved->(p->>'seat')) else p end order by ord)
        from jsonb_array_elements(coalesce(new.log->'players', '[]')) with ordinality x(p, ord)), '[]'::jsonb));
      delete from private.hidden_names where user_id = new.user_id and game_id = new.game_id;
    end if;
  end if;
  return new;
end $$;
update public.game_logs set visibility = visibility where visibility = 'friends';
