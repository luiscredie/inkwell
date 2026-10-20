-- Public games never carry the opponent's name (for example a duels.ink username).
-- The real names are kept in a private table and restored if the game is made private again.
-- Run after community.sql (safe to run again).
create schema if not exists private;
create table if not exists private.hidden_names (
  user_id uuid not null,
  game_id text not null,
  names jsonb not null,
  primary key (user_id, game_id)
);

create or replace function private.game_logs_hide_names() returns trigger
language plpgsql security definer set search_path = '' as $$
declare saved jsonb;
begin
  if new.visibility = 'public' then
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
  elsif tg_op = 'UPDATE' and old.visibility = 'public' and new.visibility = 'private' then
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
revoke all on function private.game_logs_hide_names() from public, anon, authenticated;

drop trigger if exists game_logs_hide_names on public.game_logs;
create trigger game_logs_hide_names before insert or update of visibility, log on public.game_logs
  for each row execute function private.game_logs_hide_names();

-- Games that are already public: apply the rule to them now.
update public.game_logs set visibility = visibility where visibility = 'public';
