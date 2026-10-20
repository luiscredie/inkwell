-- Short summary of each game, kept up to date by a trigger, so game lists load
-- without downloading every full game log. Run after coach_review.sql (safe to run again).
alter table public.game_logs add column if not exists summary jsonb;

create schema if not exists private;
create or replace function private.game_logs_summary() returns trigger language plpgsql set search_path = '' as $$
declare me jsonb; opp jsonb; lore jsonb;
begin
  select p into me from jsonb_array_elements(coalesce(new.log->'players', '[]')) p where p->>'is_me' = 'true' limit 1;
  if me is null then me := new.log->'players'->0; end if;
  select p into opp from jsonb_array_elements(coalesce(new.log->'players', '[]')) p where p->>'seat' is distinct from me->>'seat' limit 1;
  lore := coalesce(new.log->'result'->'final_lore', '{}'::jsonb);
  new.summary := jsonb_build_object(
    'result', case when new.log->'result'->>'winner' = me->>'seat' then 'win' else 'loss' end,
    'my_deck', coalesce(nullif(me->'deck'->>'name', ''), nullif(array_to_string(array(select jsonb_array_elements_text(coalesce(me->'deck'->'inks', '[]'::jsonb))), '/'), ''), 'Physical game'),
    'opp_deck', coalesce(nullif(opp->'deck'->>'archetype', ''), nullif(array_to_string(array(select jsonb_array_elements_text(coalesce(opp->'deck'->'inks', '[]'::jsonb))), '/'), ''), 'Unknown'),
    'went_first', case jsonb_typeof(me->'went_first') when 'boolean' then me->'went_first' else 'null'::jsonb end,
    'my_lore', coalesce(lore->(me->>'seat'), '0'::jsonb),
    'opp_lore', coalesce(lore->(opp->>'seat'), '0'::jsonb),
    'my_inks', array_to_string(array(select jsonb_array_elements_text(coalesce(me->'deck'->'inks', '[]'::jsonb))), '/'),
    'opp_inks', array_to_string(array(select jsonb_array_elements_text(coalesce(opp->'deck'->'inks', '[]'::jsonb))), '/'),
    'turns', jsonb_array_length(coalesce(new.log->'turns', '[]'::jsonb)));
  return new;
end $$;
revoke all on function private.game_logs_summary() from public, anon, authenticated;

drop trigger if exists game_logs_summary on public.game_logs;
create trigger game_logs_summary before insert or update of log on public.game_logs
  for each row execute function private.game_logs_summary();
