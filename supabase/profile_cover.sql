-- Profile background: a second card, shown
-- as the profile's cover (a Location card is
-- turned sideways by the site). Public only
-- when the profile itself is public.
alter table public.profiles
  add column if not exists cover_card text
  check (length(cover_card) <= 40);

-- save mine (null clears it)
create or replace function
  public.set_my_cover(p_card text)
returns void
language plpgsql security definer
set search_path = '' as $$
begin
  if auth.uid() is null then
    raise exception 'authentication_required'
      using errcode = '42501';
  end if;
  update public.profiles
     set cover_card = nullif(
           left(btrim(coalesce(
             p_card, '')), 40), ''),
         updated_at = now()
   where user_id = auth.uid();
end $$;

-- someone's cover, if the profile is public
create or replace function
  public.profile_cover(p_handle text)
returns text
language sql stable security definer
set search_path = '' as $$
  select p.cover_card
    from public.profiles p
   where lower(p.handle) = lower(p_handle)
     and p.is_public and p.adult
     and not p.hidden_by_admin;
$$;

revoke all on function
  public.set_my_cover(text)
  from public, anon;
grant execute on function
  public.set_my_cover(text)
  to authenticated;
grant execute on function
  public.profile_cover(text)
  to anon, authenticated;
