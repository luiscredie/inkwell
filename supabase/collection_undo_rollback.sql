-- Rollback of supabase/collection_undo.sql.
-- Removes only what it created: the two
-- functions, the delta check and the table of
-- operations (kept 1 day; nothing in it is
-- needed elsewhere). Collections are not
-- touched: what was added or undone stays.
-- The page then says "not available" and adds
-- nothing (PR #153): run this only together
-- with a revert of #153, or before its merge.
-- Safe to run again. One transaction.

begin;
drop function if exists
  public.undo_collection_op(uuid);
drop function if exists
  public.add_collection_op(text, jsonb, uuid);
drop function if exists
  private.collection_op_delta(jsonb);
drop table if exists
  private.collection_ops;
commit;
