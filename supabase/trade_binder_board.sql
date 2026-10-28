-- Mural: "Troco" (I have it to trade), what
-- Coleção's trade binder (Fichário de
-- trocas) posts. Run after trade_binder.sql
-- (safe to run again).

alter table public.listings
  drop constraint if exists
    listings_kind_check;
alter table public.listings
  add constraint listings_kind_check
  check (kind in ('borrow', 'buy', 'lend',
    'sell', 'trade'));

-- profiles list "has to trade" cards with
-- the ones lent and sold: the functions
-- that read ('sell', 'lend') learn 'trade'
do $$
declare r record; d text;
begin
  for r in
    select p.oid from pg_proc p
      join pg_namespace n
        on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.prosrc like
         '%(''sell'', ''lend'')%'
  loop
    d := pg_get_functiondef(r.oid);
    d := replace(d,
      '(''sell'', ''lend'')',
      '(''sell'', ''lend'', ''trade'')');
    execute d;
  end loop;
end $$;
