-- Etapa C4 (Amigos 2.0): a trade proposed to a friend (public.user_trades) is a notice for them, like a loan
-- request (collection_shares.sql, loan_request_notice): the bell and, with notices on, the phone (push.sql).
-- At most 20 proposals per player in any 24 hours (private.rate_hit, hardening.sql), and the same proposal
-- (same friend, same cards both ways, same money) cannot be sent again while the first is still unanswered.
-- Two proposals sent at the same moment (two tabs, a double tap) wait for each other on a per-player lock, so the
-- count and the duplicate check always see the other one.
-- Run after user_trades_listings.sql, hardening.sql and social.sql (safe to run again).
-- Rollback: drop trigger if exists user_trades_notice on public.user_trades;
--           drop function if exists private.trade_proposal_notice();
create or replace function private.trade_proposal_notice()
returns trigger
language plpgsql security definer
set search_path = '' as $$
begin
  perform pg_advisory_xact_lock(
    hashtextextended('trade_proposal:' || new.proposer::text, 0));
  if exists (
    select 1 from public.user_trades t
     where t.id <> new.id
       and t.proposer = new.proposer
       and t.partner = new.partner
       and t.status = 'proposed'
       and t.gave = new.gave and t.got = new.got
       and t.cash_brl = new.cash_brl) then
    raise exception 'duplicate_trade_proposal'
      using errcode = 'P0001',
        hint = 'The same proposal is still waiting for an answer.';
  end if;
  perform private.rate_hit(
    'trade_proposals', 20, interval '24 hours');
  insert into public.notifications
    (user_id, kind, actor, ref)
  values (new.partner, 'trade_proposal',
    new.proposer, jsonb_build_object(
      'trade', new.id,
      'n', jsonb_array_length(new.gave)
         + jsonb_array_length(new.got),
      'text', left(new.note, 80)));
  return new;
end $$;
revoke all on function
  private.trade_proposal_notice()
  from public, anon, authenticated;

drop trigger if exists user_trades_notice
  on public.user_trades;
create trigger user_trades_notice
  after insert on public.user_trades
  for each row
  execute function
    private.trade_proposal_notice();
