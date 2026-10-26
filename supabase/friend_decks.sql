-- Lore counter: pick the opponent's deck
-- from an Inkwell friend's deck list.
-- Only accepted friends; only each deck's
-- name and inks (never the card list).

create or replace function
  public.friend_decks()
returns table (
  friend uuid, friend_name text,
  deck_id text, name text, colors jsonb)
language sql stable security definer
set search_path = '' as $$
  select f.uid,
         coalesce(p.display_name, ''),
         d->>'id', d->>'name',
         coalesce(d->'colors', '[]'::jsonb)
    from (
      select case
               when fr.requester = auth.uid()
               then fr.addressee
               else fr.requester
             end as uid
        from public.friendships fr
       where fr.status = 'accepted'
         and auth.uid() in
             (fr.requester, fr.addressee)
    ) f
    left join public.profiles p
      on p.user_id = f.uid
    join public.inkwell_profiles ip
      on ip.user_id = f.uid
    cross join lateral
      jsonb_array_elements(
        case
          when jsonb_typeof(ip.data->'decks')
               = 'array'
          then ip.data->'decks'
          else '[]'::jsonb
        end) d
   where coalesce(d->>'name', '') <> ''
   order by 2, 4
   limit 500;
$$;

revoke all on function
  public.friend_decks()
  from public, anon;
grant execute on function
  public.friend_decks()
  to authenticated;
