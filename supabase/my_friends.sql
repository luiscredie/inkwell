-- My friends with their public address, so
-- the Início list can open each profile.
-- Name always; handle and avatar only when
-- that profile is public (private.face).
create or replace function
  public.my_friends()
returns jsonb
language sql stable security definer
set search_path = '' as $$
  select coalesce(jsonb_agg(
           private.face(x.o)
           || jsonb_build_object('id', x.o)),
         '[]'::jsonb)
    from (
      select case
               when f.requester = auth.uid()
               then f.addressee
               else f.requester end o
        from public.friendships f
       where f.status = 'accepted'
         and auth.uid() in
             (f.requester, f.addressee)
    ) x;
$$;

revoke all on function
  public.my_friends()
  from public, anon;
grant execute on function
  public.my_friends()
  to authenticated;
