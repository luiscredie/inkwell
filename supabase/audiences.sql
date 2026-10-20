-- Who sees a game: private (only me) / coaches / friends / group / public, plus friend groups.
-- Run after friends.sql. coach_choice.sql (run next) narrows what coaches see.

create table if not exists public.friend_groups (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null check (length(btrim(name)) between 1 and 40),
  created_at timestamptz not null default now()
);
create table if not exists public.friend_group_members (
  group_id uuid not null references public.friend_groups(id) on delete cascade,
  member uuid not null references auth.users(id) on delete cascade,
  primary key (group_id, member)
);

create or replace function private.in_group(g uuid, u uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.friend_group_members m where m.group_id = g and m.member = u);
$$;
create or replace function private.owns_group(g uuid, u uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.friend_groups x where x.id = g and x.owner_id = u);
$$;
revoke all on function private.in_group(uuid, uuid), private.owns_group(uuid, uuid) from public, anon;
grant execute on function private.in_group(uuid, uuid), private.owns_group(uuid, uuid) to authenticated;

alter table public.friend_groups enable row level security;
alter table public.friend_group_members enable row level security;
create policy "owners manage their groups" on public.friend_groups for all to authenticated
  using ((select auth.uid()) = owner_id) with check ((select auth.uid()) = owner_id);
create policy "members see groups they are in" on public.friend_groups for select to authenticated
  using ((select private.in_group(id, (select auth.uid()))));
create policy "owners manage members" on public.friend_group_members for all to authenticated
  using ((select private.owns_group(group_id, (select auth.uid())))) with check ((select private.owns_group(group_id, (select auth.uid()))));
create policy "members see their membership" on public.friend_group_members for select to authenticated
  using (member = (select auth.uid()));
grant select, insert, update, delete on public.friend_groups, public.friend_group_members to authenticated;

alter table public.game_logs add column if not exists group_id uuid references public.friend_groups(id) on delete set null;
alter table public.game_logs drop constraint if exists game_logs_visibility_check;
alter table public.game_logs add constraint game_logs_visibility_check check (visibility in ('private', 'coaches', 'friends', 'group', 'public'));

alter table public.profiles drop constraint if exists profiles_default_visibility_check;
alter table public.profiles add constraint profiles_default_visibility_check check (default_visibility in ('private', 'coaches', 'friends', 'group', 'public'));
alter table public.profiles add column if not exists default_group_id uuid references public.friend_groups(id) on delete set null;
-- (the read policy, can_read_game and the default-visibility trigger are in coach_choice.sql)
