-- Idioma das cartas — etapa 3: a post on the Mural may say the printing language (en fr de it ja zh) of the card
-- offered, or the one wanted. Null = not said ("qualquer idioma" for a post looking for a card). Run after
-- user_trades_listings.sql and trade_binder_board.sql; safe to run again. Undo with card_langs_board_rollback.sql.
alter table public.listings add column if not exists lang text;
alter table public.listings drop constraint if exists listings_lang_check;
alter table public.listings add constraint listings_lang_check
  check (lang is null or lang in ('en', 'fr', 'de', 'it', 'ja', 'zh'));
