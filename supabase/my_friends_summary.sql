-- Amigos 2.0, etapa B (issue #164): the Amigos page asked rpc/friend_collection(handle, false) once per friend
-- with a public address, for at most 24 friends (N+1). my_friends_summary() answers the same question for every
-- friend in one read, with no limit.
-- Same rule as friend_collection(): an accepted friendship and a collection the friend opened to all friends
-- (collection_privacy.friends_view). As the page did, only friends whose profile is public (private.face gives a
-- handle), because "Ver coleção" opens Coleção by that handle (colecao/?amigo=handle).
-- Only counts and flags: never the cards, names, handles or e-mails (rpc/my_friends already gives name, handle and
-- avatar under its own rule). Pending requests, non-friends and collections not opened to friends never appear.
-- security definer: it reads other members' collection_privacy and inkwell_profiles rows, which RLS closes, exactly
-- like friend_collection(); search_path is empty and every name is schema-qualified.
-- stable (read-only): "rpc/my_*" is already a shared read in src/site/cloud.js, so no client change there.
-- Run after collection_shares.sql and communities.sql (private.face). Safe to run again.
-- Rollback: drop function if exists public.my_friends_summary();   (the page falls back to the old reads)
create or replace function public.my_friends_summary()
returns jsonb
language sql stable security definer
set search_path = '' as $$
  with fr as (
    select case when f.requester = auth.uid()
             then f.addressee else f.requester end uid
      from public.friendships f
     where f.status = 'accepted'
       and auth.uid() in (f.requester, f.addressee))
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', fr.uid,
           'view', true,
           'lend', cp.friends_lend,
           'cards', (select count(*)
              from public.inkwell_profiles ip,
                jsonb_each(case when jsonb_typeof(
                  ip.data->'collection') = 'object'
                  then ip.data->'collection'
                  else '{}'::jsonb end) c
             where ip.user_id = cp.user_id
               and ip.profile = cp.profile))
         order by fr.uid), '[]'::jsonb)
    from fr
    join public.collection_privacy cp
      on cp.user_id = fr.uid and cp.friends_view
   where private.face(fr.uid)->>'handle' is not null;
$$;

revoke all on function
  public.my_friends_summary()
  from public, anon;
grant execute on function
  public.my_friends_summary()
  to authenticated;
