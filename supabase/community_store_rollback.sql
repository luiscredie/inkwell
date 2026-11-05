-- Undo community_store.sql: removes only what it created (the links, their log and the five functions).
-- Communities, members, posts and event marks are untouched. Safe to run twice.
drop function if exists public.request_community_store(text, jsonb);
drop function if exists public.remove_community_store(text);
drop function if exists public.community_store(text);
drop function if exists public.admin_community_stores(text);
drop function if exists public.decide_community_store(uuid, text, text);
drop table if exists public.community_stores;
drop table if exists private.community_store_log;
