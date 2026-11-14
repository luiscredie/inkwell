-- Idioma das cartas na coleção (etapa 1). Run once in Supabase Dashboard > SQL Editor, after collection_undo.sql
-- and deck_built.sql. Safe to run again. Undo with card_langs_rollback.sql.
--
-- A card in inkwell_profiles.data.collection keeps its totals and may carry a language split:
--   "LOR1-1": { "n": 3, "f": 1, "l": { "ja": { "n": 1, "f": 1 }, "en": { "n": 1 } } }
-- n and f are still every copy (decks, loans, value and friends read only these). l says the printing language of
-- some of them; what is left (here 1 normal) has no language recorded ("sem idioma"). Never more in l than in the
-- total, per finish. Languages: en, fr, de, it, ja, zh. Nothing here rewrites a collection that has no l.
--
-- Rules (approved by the Inkwell Conselho, 13/11/2026):
--   * adding with a language records it; adding without one leaves the copies "sem idioma";
--   * removing with a language takes from that language; without one it takes the copies "sem idioma" first, then
--     the only language left, and refuses with lang_required when two or more languages could lose a copy;
--   * the server never trims l by itself: a change that would leave it inconsistent is refused;
--   * a language mark-up of old copies (mark_unknown_langs) is one operation, all or nothing, checked against the
--     collection's revision, and can be undone for a day (undo_lang_op), even after reloading the page.

-- ---------- helpers ----------
create or replace function private.lang_ok(p text) returns boolean
language sql immutable set search_path = '' as $$
  select p in ('en', 'fr', 'de', 'it', 'ja', 'zh')
$$;

-- l without zeros, empty languages or anything that isn't a known language with whole counts
create or replace function private.langs_clean(p jsonb) returns jsonb
language sql immutable set search_path = '' as $$
  select coalesce(jsonb_object_agg(x.key, x.v), '{}'::jsonb) from (
    select l.key, (select jsonb_object_agg(k.key, k.value) from jsonb_each(l.value) k
                    where k.key in ('n', 'f') and jsonb_typeof(k.value) = 'number' and (k.value)::text::int > 0) v
      from jsonb_each(case when jsonb_typeof(p) = 'object' then p else '{}'::jsonb end) l
     where private.lang_ok(l.key) and jsonb_typeof(l.value) = 'object') x
   where x.v is not null
$$;

-- copies of one finish (n or f) that have a language
create or replace function private.lang_known(p_entry jsonb, p_k text) returns int
language sql immutable set search_path = '' as $$
  select coalesce(sum(coalesce((l.value->>p_k)::int, 0)), 0)::int
    from jsonb_each(private.langs_clean(p_entry->'l')) l
$$;

-- one card after adding (q > 0) or removing (q < 0) copies of one finish, in p_lang or with no language.
-- p_strict (undo): never more than there is, and never guess; the error is collection_changed.
create or replace function private.entry_apply(p_entry jsonb, p_card text, p_k text, p_q int, p_lang text, p_strict boolean)
returns jsonb language plpgsql immutable set search_path = '' as $$
declare
  cur jsonb := coalesce(p_entry, '{"n": 0, "f": 0}'::jsonb);
  l jsonb := private.langs_clean(cur->'l');
  total int := coalesce((cur->>p_k)::int, 0);
  unknown int; need int; have int; rest int; langs text[]; x text;
begin
  if p_lang is not null and not private.lang_ok(p_lang) then
    raise exception 'bad lang';
  end if;
  unknown := greatest(0, total - private.lang_known(cur, p_k));
  if p_q > 0 then
    total := total + p_q;
    if p_lang is not null then
      l := l || jsonb_build_object(p_lang, coalesce(l->p_lang, '{}'::jsonb)
        || jsonb_build_object(p_k, coalesce((l->p_lang->>p_k)::int, 0) + p_q));
    end if;
  elsif p_q < 0 then
    need := -p_q;
    if p_strict and total < need then
      raise exception 'collection_changed' using detail = p_card || ' ' || p_k;
    end if;
    if p_lang is not null then
      have := coalesce((l->p_lang->>p_k)::int, 0);
      if have < need then
        if p_strict then raise exception 'collection_changed' using detail = p_card || ' ' || p_k || ' ' || p_lang; end if;
        raise exception 'lang_short' using detail = p_card || ' ' || p_k || ' ' || p_lang;
      end if;
      l := l || jsonb_build_object(p_lang, (l->p_lang) || jsonb_build_object(p_k, have - need));
    elsif need > unknown then
      if p_strict then
        -- an undo takes back copies that had no language: if some got one since, it is no longer the same thing
        raise exception 'collection_changed' using detail = p_card || ' ' || p_k;
      elsif total <= need then
        -- every copy of this finish goes: no doubt about which ones
        for x in select key from jsonb_each(l) loop
          l := l || jsonb_build_object(x, (l->x) || jsonb_build_object(p_k, 0));
        end loop;
      else
        rest := need - unknown;
        langs := array(select key from jsonb_each(l) where coalesce((value->>p_k)::int, 0) > 0);
        if coalesce(array_length(langs, 1), 0) = 1
           and coalesce((l->langs[1]->>p_k)::int, 0) >= rest then
          l := l || jsonb_build_object(langs[1], (l->langs[1])
            || jsonb_build_object(p_k, (l->langs[1]->>p_k)::int - rest));
        else
          raise exception 'lang_required' using detail = p_card || ' ' || p_k;
        end if;
      end if;
    end if;
    total := greatest(0, total - need);
  end if;
  cur := jsonb_set(cur, array[p_k], to_jsonb(total));
  l := private.langs_clean(l);
  return case when l = '{}'::jsonb then cur - 'l' else jsonb_set(cur, '{l}', l) end;
end $$;

-- who may change a collection: its owner, or a member it is shared with to edit
create or replace function private.can_edit_collection(p_owner uuid, p_profile text) returns boolean
language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and (p_owner = auth.uid() or exists (
    select 1 from public.collection_shares
     where owner = p_owner and profile = p_profile and member = auth.uid() and can_edit))
$$;

revoke all on function private.lang_ok(text), private.langs_clean(jsonb), private.lang_known(jsonb, text),
  private.entry_apply(jsonb, text, text, int, text, boolean), private.can_edit_collection(uuid, text) from public, anon, authenticated;
-- the loans' CHECK (private.valid_items) runs as the player who saves a loan, and calls lang_ok
grant execute on function private.lang_ok(text) to authenticated;

-- ---------- every change of quantities: the same function as before, now keeping l right ----------
create or replace function private.collection_delta_for(u uuid, p_profile text, p_delta jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare d jsonb; e jsonb; k text;
begin
  if jsonb_typeof(p_delta) <> 'array'
     or jsonb_array_length(p_delta) > 400 then
    raise exception 'bad delta';
  end if;
  select data into d
    from public.inkwell_profiles
   where user_id = u and profile = p_profile
   for update;
  if d is null then
    raise exception 'profile not found';
  end if;
  d := jsonb_set(d, '{collection}',
    coalesce(d->'collection', '{}'::jsonb));
  for e in select * from
      jsonb_array_elements(p_delta) loop
    if coalesce(e->>'card_id', '') = ''
       or length(e->>'card_id') > 40
       or jsonb_typeof(e->'qty') <> 'number'
       or (e->>'lang' is not null and not private.lang_ok(e->>'lang'))
    then
      raise exception 'bad delta item';
    end if;
    k := case when coalesce(
      (e->>'foil')::boolean, false)
      then 'f' else 'n' end;
    d := jsonb_set(d, array['collection', e->>'card_id'],
      private.entry_apply(d->'collection'->(e->>'card_id'), e->>'card_id', k,
        (e->>'qty')::int, e->>'lang', false));
  end loop;
  update public.inkwell_profiles
     set data = d, revision = revision + 1,
         updated_at = now()
   where user_id = u and profile = p_profile;
end $$;

-- the logged add (Decks > "add to the collection" and others): keeps the language, so the undo takes the same copies
create or replace function private.collection_op_delta(p jsonb)
returns jsonb language plpgsql immutable set search_path = '' as $$
declare e jsonb; out jsonb := '[]';
begin
  if jsonb_typeof(p) is distinct from
       'array'
     or jsonb_array_length(p) = 0
     or jsonb_array_length(p) > 400 then
    raise exception 'bad delta';
  end if;
  for e in select * from
      jsonb_array_elements(p) loop
    if jsonb_typeof(e) <> 'object'
       or coalesce(e->>'card_id', '') = ''
       or length(e->>'card_id') > 40
       or jsonb_typeof(e->'qty') <> 'number'
       or (e->>'qty') !~ '^[1-9][0-9]{0,2}$'
       or coalesce(jsonb_typeof(e->'foil'),
            'boolean') <> 'boolean'
       or (e->>'lang' is not null and not private.lang_ok(e->>'lang')) then
      raise exception 'bad delta item';
    end if;
    out := out || jsonb_build_array(
      jsonb_build_object(
        'card_id', e->>'card_id',
        'qty', (e->>'qty')::int,
        'foil', coalesce(
          (e->>'foil')::boolean, false))
      || case when e->>'lang' is null then '{}'::jsonb else jsonb_build_object('lang', e->>'lang') end);
  end loop;
  return out;
end $$;

create or replace function public.undo_collection_op(p_op uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  u uuid := auth.uid();
  o private.collection_ops;
  d jsonb; e jsonb; k text;
begin
  if u is null then
    raise exception 'authentication_required'
      using errcode = '42501';
  end if;
  if p_op is null then
    raise exception 'bad op';
  end if;
  select * into o
    from private.collection_ops
   where op_id = p_op;
  if not found or o.user_id <> u then
    raise exception 'op_not_found';
  end if;
  select data into d
    from public.inkwell_profiles
   where user_id = u and profile = o.profile
   for update;
  if d is null then
    raise exception 'profile not found';
  end if;
  select * into o
    from private.collection_ops
   where op_id = p_op for update;
  if o.undone_at is not null then
    raise exception 'already_undone';
  end if;
  if o.created_at
     < now() - interval '10 minutes' then
    raise exception 'undo_expired';
  end if;
  d := jsonb_set(d, '{collection}',
    coalesce(d->'collection', '{}'::jsonb));
  for e in select * from
      jsonb_array_elements(o.delta) loop
    k := case when (e->>'foil')::boolean
      then 'f' else 'n' end;
    -- the same copies that were added: in their language, or "sem idioma"; anything else is collection_changed
    d := jsonb_set(d, array['collection', e->>'card_id'],
      private.entry_apply(d->'collection'->(e->>'card_id'), e->>'card_id', k,
        -((e->>'qty')::int), e->>'lang', true));
  end loop;
  update public.inkwell_profiles
     set data = d, revision = revision + 1,
         updated_at = now()
   where user_id = u and profile = o.profile;
  update private.collection_ops
     set undone_at = now()
   where op_id = p_op;
  return jsonb_build_object(
    'status', 'undone');
end $$;

-- ---------- loans: an item may say its language (the copy lent is still yours, and still that language) ----------
create or replace function private.valid_items(p jsonb) returns boolean
language sql immutable set search_path = '' as $$
  select jsonb_typeof(p) = 'array' and jsonb_array_length(p) <= 200 and not exists (
    select 1 from jsonb_array_elements(p) e
    where jsonb_typeof(e) <> 'object' or coalesce(e->>'card_id', '') = '' or length(e->>'card_id') > 40
       or jsonb_typeof(e->'qty') <> 'number' or (e->>'qty')::numeric not between 1 and 99
       or (e->>'lang' is not null and not private.lang_ok(e->>'lang')));
$$;

-- ---------- language operations (marking old copies, editing a card's split), undoable for a day ----------
create table if not exists private.collection_lang_ops (
  op_id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,   -- who did it
  owner uuid not null references auth.users(id) on delete cascade,     -- whose collection
  profile text not null,
  kind text not null check (kind in ('mark', 'set')),
  cards jsonb not null,             -- { card_id: { "b": l before, "a": l after } }  (null = no language)
  copies int not null default 0,    -- copies that got a language
  created_at timestamptz not null default now(),
  undone_at timestamptz);
alter table private.collection_lang_ops enable row level security;
revoke all on private.collection_lang_ops from public, anon, authenticated;
create index if not exists collection_lang_ops_who on private.collection_lang_ops (user_id, owner, profile, created_at desc);

-- the language split of one card, as the card sheet edits it (p_langs = the whole new l)
create or replace function public.set_card_langs(p_owner uuid, p_profile text, p_card_id text, p_langs jsonb, p_op uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare u uuid := coalesce(p_owner, auth.uid()); d jsonb; cur jsonb; nl jsonb; rev bigint; x record;
begin
  if not private.can_edit_collection(u, p_profile) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_op is null or coalesce(p_card_id, '') = '' or length(p_card_id) > 40 or jsonb_typeof(p_langs) <> 'object' then
    raise exception 'bad request';
  end if;
  for x in select key, value from jsonb_each(p_langs) loop
    if not private.lang_ok(x.key) or jsonb_typeof(x.value) <> 'object'
       or exists (select 1 from jsonb_each(x.value) y where y.key not in ('n', 'f') or jsonb_typeof(y.value) <> 'number'
                    or (y.value)::text !~ '^[0-9]{1,3}$') then
      raise exception 'bad langs';
    end if;
  end loop;
  select data, revision into d, rev from public.inkwell_profiles where user_id = u and profile = p_profile for update;
  if d is null then raise exception 'profile not found'; end if;
  if exists (select 1 from private.collection_lang_ops where op_id = p_op) then raise exception 'op_conflict'; end if;
  cur := d->'collection'->p_card_id;
  if cur is null then raise exception 'card not found'; end if;
  nl := private.langs_clean(p_langs);
  if private.lang_known(jsonb_build_object('l', nl), 'n') > coalesce((cur->>'n')::int, 0)
     or private.lang_known(jsonb_build_object('l', nl), 'f') > coalesce((cur->>'f')::int, 0) then
    raise exception 'too_many';
  end if;
  insert into private.collection_lang_ops (op_id, user_id, owner, profile, kind, cards, copies)
  values (p_op, auth.uid(), u, p_profile, 'set',
    jsonb_build_object(p_card_id, jsonb_build_object('b', nullif(private.langs_clean(cur->'l'), '{}'::jsonb), 'a', nullif(nl, '{}'::jsonb))), 0);
  cur := case when nl = '{}'::jsonb then cur - 'l' else jsonb_set(cur, '{l}', nl) end;
  update public.inkwell_profiles
     set data = jsonb_set(d, array['collection', p_card_id], cur), revision = revision + 1, updated_at = now()
   where user_id = u and profile = p_profile
  returning revision into rev;
  delete from private.collection_lang_ops where created_at < now() - interval '1 day';
  return jsonb_build_object('status', 'applied', 'revision', rev, 'entry', cur);
end $$;

-- marking copies that have no language yet. p_items: [{card_id, lang, qty, foil}], summed per card and finish;
-- p_rest: a language for every copy still without one after the items (or null). All or nothing.
create or replace function public.mark_unknown_langs(p_owner uuid, p_profile text, p_items jsonb, p_rest text,
  p_expected_revision bigint, p_op uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  u uuid := coalesce(p_owner, auth.uid()); d jsonb; rev bigint; e jsonb; x record; k text;
  cur jsonb; before jsonb := '{}'; cards jsonb := '{}'; copies int := 0; unk int; prev private.collection_lang_ops;
begin
  if not private.can_edit_collection(u, p_profile) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  p_items := coalesce(p_items, '[]');
  if p_op is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) > 5000
     or (p_rest is not null and not private.lang_ok(p_rest)) then
    raise exception 'bad request';
  end if;
  for e in select * from jsonb_array_elements(p_items) loop
    if jsonb_typeof(e) <> 'object' or coalesce(e->>'card_id', '') = '' or length(e->>'card_id') > 40
       or not coalesce(private.lang_ok(e->>'lang'), false) or jsonb_typeof(e->'qty') <> 'number'
       or (e->>'qty') !~ '^[1-9][0-9]{0,2}$' or coalesce(jsonb_typeof(e->'foil'), 'boolean') <> 'boolean' then
      raise exception 'bad item';
    end if;
  end loop;
  select data, revision into d, rev from public.inkwell_profiles where user_id = u and profile = p_profile for update;
  if d is null then raise exception 'profile not found'; end if;
  select * into prev from private.collection_lang_ops where op_id = p_op;
  if found then
    if prev.user_id = auth.uid() and prev.owner = u and prev.profile = p_profile then
      return jsonb_build_object('status', 'already_applied', 'revision', rev, 'copies', prev.copies);
    end if;
    raise exception 'op_conflict';
  end if;
  if p_expected_revision is distinct from rev then
    raise exception 'collection_changed' using detail = 'revision ' || rev;
  end if;
  -- per card and finish: never more than the copies without a language (normal and foil apart)
  for x in select i->>'card_id' card, case when coalesce((i->>'foil')::boolean, false) then 'f' else 'n' end k,
                  sum((i->>'qty')::int)::int q
             from jsonb_array_elements(p_items) i group by 1, 2 loop
    cur := d->'collection'->x.card;
    unk := greatest(0, coalesce((cur->>x.k)::int, 0) - private.lang_known(cur, x.k));
    if cur is null or x.q > unk then
      raise exception 'lang_conflict' using detail = x.card || ' ' || x.k || ' ' || x.q || ' > ' || unk;
    end if;
  end loop;
  for e in select * from jsonb_array_elements(p_items) loop
    k := case when coalesce((e->>'foil')::boolean, false) then 'f' else 'n' end;
    if not before ? (e->>'card_id') then
      before := before || jsonb_build_object(e->>'card_id', coalesce(d->'collection'->(e->>'card_id')->'l', 'null'::jsonb));
    end if;
    d := jsonb_set(d, array['collection', e->>'card_id'],
      private.entry_apply(d->'collection'->(e->>'card_id'), e->>'card_id', k, (e->>'qty')::int, e->>'lang', false)
        || jsonb_build_object(k, (d->'collection'->(e->>'card_id')->>k)::int));   -- the total stays as it was
    copies := copies + (e->>'qty')::int;
  end loop;
  if p_rest is not null then
    for x in select key card, value v from jsonb_each(coalesce(d->'collection', '{}'::jsonb)) where jsonb_typeof(value) = 'object' loop
      cur := x.v;
      foreach k in array array['n', 'f'] loop
        unk := greatest(0, coalesce((cur->>k)::int, 0) - private.lang_known(cur, k));
        if unk > 0 then
          if not before ? x.card then before := before || jsonb_build_object(x.card, coalesce(x.v->'l', 'null'::jsonb)); end if;
          cur := private.entry_apply(cur, x.card, k, unk, p_rest, false) || jsonb_build_object(k, (cur->>k)::int);
          copies := copies + unk;
        end if;
      end loop;
      if cur is distinct from x.v then d := jsonb_set(d, array['collection', x.card], cur); end if;
    end loop;
  end if;
  if copies = 0 then
    return jsonb_build_object('status', 'unchanged', 'revision', rev, 'copies', 0);
  end if;
  select jsonb_object_agg(b.key, jsonb_build_object(
           'b', nullif(private.langs_clean(b.value), '{}'::jsonb),
           'a', nullif(private.langs_clean(d->'collection'->b.key->'l'), '{}'::jsonb)))
    into cards from jsonb_each(before) b;
  update public.inkwell_profiles set data = d, revision = revision + 1, updated_at = now()
   where user_id = u and profile = p_profile returning revision into rev;
  insert into private.collection_lang_ops (op_id, user_id, owner, profile, kind, cards, copies)
  values (p_op, auth.uid(), u, p_profile, 'mark', cards, copies);
  delete from private.collection_lang_ops where created_at < now() - interval '1 day';
  return jsonb_build_object('status', 'applied', 'revision', rev, 'copies', copies);
end $$;

-- undo a language operation: every card it touched must still have the split it left (else collection_changed)
create or replace function public.undo_lang_op(p_op uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare o private.collection_lang_ops; d jsonb; rev bigint; x record; cur jsonb; b jsonb;
begin
  if auth.uid() is null then raise exception 'authentication_required' using errcode = '42501'; end if;
  select * into o from private.collection_lang_ops where op_id = p_op;
  if not found or o.user_id <> auth.uid() then raise exception 'op_not_found'; end if;
  if not private.can_edit_collection(o.owner, o.profile) then raise exception 'not allowed' using errcode = '42501'; end if;
  select data into d from public.inkwell_profiles where user_id = o.owner and profile = o.profile for update;
  if d is null then raise exception 'profile not found'; end if;
  select * into o from private.collection_lang_ops where op_id = p_op for update;
  if o.undone_at is not null then raise exception 'already_undone'; end if;
  if o.created_at < now() - interval '1 day' then raise exception 'undo_expired'; end if;
  for x in select key card, value v from jsonb_each(o.cards) loop
    cur := d->'collection'->x.card;
    if cur is null or coalesce(nullif(private.langs_clean(cur->'l'), '{}'::jsonb), 'null'::jsonb)
                      is distinct from coalesce(x.v->'a', 'null'::jsonb) then
      raise exception 'collection_changed' using detail = x.card;
    end if;
    b := private.langs_clean(x.v->'b');
    if private.lang_known(jsonb_build_object('l', b), 'n') > coalesce((cur->>'n')::int, 0)
       or private.lang_known(jsonb_build_object('l', b), 'f') > coalesce((cur->>'f')::int, 0) then
      raise exception 'collection_changed' using detail = x.card;
    end if;
    d := jsonb_set(d, array['collection', x.card], case when b = '{}'::jsonb then cur - 'l' else jsonb_set(cur, '{l}', b) end);
  end loop;
  update public.inkwell_profiles set data = d, revision = revision + 1, updated_at = now()
   where user_id = o.owner and profile = o.profile returning revision into rev;
  update private.collection_lang_ops set undone_at = now() where op_id = p_op;
  return jsonb_build_object('status', 'undone', 'revision', rev);
end $$;

-- the last mark-up of old copies this player can still undo in this collection (or null)
create or replace function public.last_lang_op(p_owner uuid, p_profile text)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('op_id', op_id, 'created_at', created_at, 'copies', copies)
    from private.collection_lang_ops
   where user_id = auth.uid() and owner = coalesce(p_owner, auth.uid()) and profile = p_profile
     and kind = 'mark' and undone_at is null and created_at > now() - interval '1 day'
   order by created_at desc limit 1
$$;

-- the collection's language preferences (data.prefs): card_lang (default language), card_lang_ask (ask on every
-- add) and card_lang_prompt ('later' | 'done': what the player answered about old copies)
create or replace function public.set_collection_prefs(p_owner uuid, p_profile text, p_prefs jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare u uuid := coalesce(p_owner, auth.uid()); pr jsonb; rev bigint;
begin
  if not private.can_edit_collection(u, p_profile) then raise exception 'not allowed' using errcode = '42501'; end if;
  if jsonb_typeof(p_prefs) <> 'object'
     or exists (select 1 from jsonb_object_keys(p_prefs) k where k not in ('card_lang', 'card_lang_ask', 'card_lang_prompt'))
     or (p_prefs ? 'card_lang' and not coalesce(private.lang_ok(p_prefs->>'card_lang'), false))
     or (p_prefs ? 'card_lang_ask' and jsonb_typeof(p_prefs->'card_lang_ask') <> 'boolean')
     or (p_prefs ? 'card_lang_prompt' and jsonb_typeof(p_prefs->'card_lang_prompt') <> 'null'
         and coalesce(p_prefs->>'card_lang_prompt', '') not in ('later', 'done')) then
    raise exception 'bad prefs';
  end if;
  select coalesce(case when jsonb_typeof(data->'prefs') = 'object' then data->'prefs' end, '{}'::jsonb) || p_prefs into pr
    from public.inkwell_profiles where user_id = u and profile = p_profile for update;
  if pr is null then raise exception 'profile not found'; end if;
  pr := jsonb_strip_nulls(pr);
  update public.inkwell_profiles set data = jsonb_set(data, '{prefs}', pr), revision = revision + 1, updated_at = now()
   where user_id = u and profile = p_profile returning revision into rev;
  return jsonb_build_object('prefs', pr, 'revision', rev);
end $$;

-- what the language screens need before saving: the collection's revision (to notice a change made on another
-- device during the check) and its language preferences. Owner or a member who can edit.
create or replace function public.collection_lang_state(p_owner uuid, p_profile text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare r jsonb;
begin
  if not private.can_edit_collection(coalesce(p_owner, auth.uid()), p_profile) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  select jsonb_build_object('revision', revision,
           'prefs', coalesce(case when jsonb_typeof(data->'prefs') = 'object' then data->'prefs' end, '{}'::jsonb))
    into r from public.inkwell_profiles where user_id = coalesce(p_owner, auth.uid()) and profile = p_profile;
  if r is null then raise exception 'profile not found'; end if;
  return r;
end $$;

revoke all on function public.set_card_langs(uuid, text, text, jsonb, uuid), public.mark_unknown_langs(uuid, text, jsonb, text, bigint, uuid),
  public.undo_lang_op(uuid), public.last_lang_op(uuid, text), public.set_collection_prefs(uuid, text, jsonb),
  public.collection_lang_state(uuid, text) from public, anon;
grant execute on function public.set_card_langs(uuid, text, text, jsonb, uuid), public.mark_unknown_langs(uuid, text, jsonb, text, bigint, uuid),
  public.undo_lang_op(uuid), public.last_lang_op(uuid, text), public.set_collection_prefs(uuid, text, jsonb),
  public.collection_lang_state(uuid, text) to authenticated;
