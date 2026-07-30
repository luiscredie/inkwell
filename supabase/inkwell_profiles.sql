-- Inkwell cross-device profile storage.
-- Run once in Supabase Dashboard > SQL Editor.

create table if not exists public.inkwell_profiles (
  user_id uuid not null references auth.users(id) on delete cascade,
  profile text not null check (length(profile) between 1 and 80),
  data jsonb not null default '{}'::jsonb,
  schema integer not null default 1,
  revision bigint not null default 1,
  updated_at timestamptz not null default now(),
  primary key (user_id, profile)
);

-- Safe upgrade path for a table created by the earlier frontend-only release.
alter table public.inkwell_profiles
  add column if not exists schema integer not null default 1,
  add column if not exists revision bigint not null default 1,
  add column if not exists updated_at timestamptz not null default now();

alter table public.inkwell_profiles enable row level security;

drop policy if exists "owners can read profiles" on public.inkwell_profiles;
create policy "owners can read profiles"
on public.inkwell_profiles for select
using ((select auth.uid()) = user_id);

drop policy if exists "owners can insert profiles" on public.inkwell_profiles;
create policy "owners can insert profiles"
on public.inkwell_profiles for insert
with check ((select auth.uid()) = user_id);

drop policy if exists "owners can update profiles" on public.inkwell_profiles;
create policy "owners can update profiles"
on public.inkwell_profiles for update
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

drop policy if exists "owners can delete profiles" on public.inkwell_profiles;
create policy "owners can delete profiles"
on public.inkwell_profiles for delete
using ((select auth.uid()) = user_id);

-- Atomic compare-and-swap prevents two devices from silently overwriting each other.
create or replace function public.sync_inkwell_profile(
  p_profile text,
  p_data jsonb,
  p_schema integer,
  p_expected_revision bigint
)
returns public.inkwell_profiles
language plpgsql
security invoker
set search_path = public
as $$
declare
  result public.inkwell_profiles;
begin
  if auth.uid() is null then
    raise exception 'authentication_required' using errcode = '42501';
  end if;

  if coalesce(p_expected_revision, 0) = 0 then
    insert into public.inkwell_profiles(user_id, profile, data, schema)
    values (auth.uid(), p_profile, p_data, p_schema)
    on conflict (user_id, profile) do nothing
    returning * into result;
  else
    update public.inkwell_profiles
       set data = p_data,
           schema = p_schema,
           revision = revision + 1,
           updated_at = now()
     where user_id = auth.uid()
       and profile = p_profile
       and revision = p_expected_revision
    returning * into result;
  end if;

  if result.user_id is null then
    raise exception 'revision_conflict' using errcode = '40001';
  end if;
  return result;
end;
$$;

revoke all on function public.sync_inkwell_profile(text,jsonb,integer,bigint) from public;
grant execute on function public.sync_inkwell_profile(text,jsonb,integer,bigint) to authenticated;
