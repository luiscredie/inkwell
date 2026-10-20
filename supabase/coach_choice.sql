-- Who sees a game, coach side: all my coaches, one coach, or a named coach group.
--   game_logs.visibility = 'coaches' and
--     coach_group_id set -> only coaches listed in that group (coach_groups.emails)
--     coach_email set    -> only that coach
--     neither            -> every coach the player added (coach_links)
-- Coaches see only games shared with coaches (or with everyone, or with friends / a friend group
-- they belong to as a user). They no longer see every non-private game automatically.
-- Run after friends.sql and the audiences migration (friend_groups, game_logs.group_id).

create table if not exists public.coach_groups (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 60),
  emails text[] not null default '{}',
  created_at timestamptz not null default now()
);
create index if not exists coach_groups_owner on public.coach_groups(owner_id);
alter table public.coach_groups enable row level security;
drop policy if exists "owners manage coach groups" on public.coach_groups;
create policy "owners manage coach groups" on public.coach_groups for all
  using ((select auth.uid()) = owner_id) with check ((select auth.uid()) = owner_id);
grant select, insert, update, delete on public.coach_groups to authenticated;

alter table public.game_logs add column if not exists coach_email text;
alter table public.game_logs add column if not exists coach_group_id uuid references public.coach_groups(id) on delete set null;
alter table public.profiles add column if not exists default_coach_email text;
alter table public.profiles add column if not exists default_coach_group_id uuid references public.coach_groups(id) on delete set null;

create or replace function private.coach_sees(p_owner uuid, p_vis text, p_email text, p_group uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select p_vis = 'coaches'
     and exists (select 1 from public.coach_links c
                 where c.owner_id = p_owner and c.coach_email = lower((select auth.jwt() ->> 'email')))
     and case
           when p_group is not null then exists (select 1 from public.coach_groups g
                 where g.id = p_group and g.owner_id = p_owner and lower((select auth.jwt() ->> 'email')) = any (g.emails))
           when p_email is not null then lower(p_email) = lower((select auth.jwt() ->> 'email'))
           else true
         end;
$$;
revoke all on function private.coach_sees(uuid, text, text, uuid) from public, anon;
grant execute on function private.coach_sees(uuid, text, text, uuid) to authenticated;

drop policy if exists "readers see game logs" on public.game_logs;
create policy "readers see game logs" on public.game_logs for select using (
     (select auth.uid()) = user_id
  or visibility = 'public'
  or (visibility = 'friends' and (select private.are_friends(user_id, (select auth.uid()))))
  or (visibility = 'group' and group_id is not null and (select private.in_group(group_id, (select auth.uid()))))
  or (select private.coach_sees(user_id, visibility, coach_email, coach_group_id))
);

create or replace function private.can_read_game(p_owner uuid, p_game text)
returns boolean language sql stable security definer set search_path = '' as $$
  select p_owner = (select auth.uid())
      or exists (select 1 from public.game_logs g where g.user_id = p_owner and g.game_id = p_game and (
           g.visibility = 'public'
        or (g.visibility = 'friends' and private.are_friends(p_owner, (select auth.uid())))
        or (g.visibility = 'group' and g.group_id is not null and private.in_group(g.group_id, (select auth.uid())))
        or private.coach_sees(p_owner, g.visibility, g.coach_email, g.coach_group_id)));
$$;

create or replace function private.game_logs_default_visibility()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v text; g uuid; ce text; cg uuid;
begin
  if new.visibility = 'private' and new.group_id is null then
    select p.default_visibility, p.default_group_id, p.default_coach_email, p.default_coach_group_id
      into v, g, ce, cg from public.profiles p where p.user_id = new.user_id;
    if v = 'group' and g is null then v := 'private'; end if;
    new.visibility := coalesce(v, 'private');
    if v = 'group' then new.group_id := g; end if;
    if v = 'coaches' then new.coach_email := ce; new.coach_group_id := cg; end if;
  end if;
  return new;
end $$;
