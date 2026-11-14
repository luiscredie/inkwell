-- Undo supabase/card_langs_board.sql: the posts lose their language (the rest of each post stays).
alter table public.listings drop constraint if exists listings_lang_check;
alter table public.listings drop column if exists lang;
