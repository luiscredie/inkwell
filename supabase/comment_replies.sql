-- Início: reply to a comment and like a
-- comment.
--  * Replies have one level, like Instagram:
--    a reply to a reply goes under the same
--    first comment, starting with @name, and
--    tells the person replied to.
--  * Liking a comment tells its author only
--    inside the site (the bell), never on the
--    phone.
--  * Deleting a comment that has replies
--    leaves "comentário apagado" (text gone)
--    so the replies keep their sense.
-- Run after social.sql (safe to run again).

alter table public.post_comments
  add column if not exists reply_to uuid
    references public.post_comments(id)
    on delete cascade;
alter table public.post_comments
  add column if not exists reply_user uuid
    references auth.users(id)
    on delete set null;
alter table public.post_comments
  add column if not exists deleted boolean
    not null default false;
create index if not exists
  post_comments_reply
  on public.post_comments (reply_to)
  where reply_to is not null;

create table if not exists
  public.comment_likes (
  comment_id uuid not null
    references public.post_comments(id)
    on delete cascade,
  user_id uuid not null
    references auth.users(id)
    on delete cascade,
  created_at timestamptz not null
    default now(),
  primary key (comment_id, user_id));
create index if not exists comment_likes_user
  on public.comment_likes (user_id);
alter table public.comment_likes
  enable row level security;
revoke all on public.comment_likes
  from anon, authenticated;

-- one comment, as the page shows it
create or replace function
  private.comment_json(
    c public.post_comments)
returns jsonb
language sql stable security definer
set search_path = '' as $$
  select case when c.deleted then
    jsonb_build_object('id', c.id,
      'at', c.created_at, 'deleted', true,
      'parent', c.reply_to, 'body', '',
      'likes', 0, 'liked', false,
      'mine', false)
  else private.face(c.author)
    || jsonb_build_object(
      'id', c.id, 'body', c.body,
      'at', c.created_at,
      'mine', c.author = auth.uid(),
      'parent', c.reply_to,
      'reply_name', (select display_name
        from public.profiles
       where user_id = c.reply_user),
      'likes', (select count(*)
        from public.comment_likes l
       where l.comment_id = c.id),
      'liked', exists (select 1
        from public.comment_likes l
       where l.comment_id = c.id
         and l.user_id = auth.uid()))
  end;
$$;
revoke all on function private.comment_json(
  public.post_comments) from public;

-- the post, with comments that know their
-- replies (same fields as before)
create or replace function
  private.post_json(p public.posts)
returns jsonb
language sql stable security definer
set search_path = '' as $$
  select private.face(p.author)
    || jsonb_build_object(
      'id', p.id, 'author', p.author,
      'body', p.body,
      'card', p.card_id, 'foil', p.foil,
      'cards', coalesce(p.cards,
        case when p.card_id is not null
          then jsonb_build_array(
            jsonb_build_object(
              'id', p.card_id,
              'foil', p.foil)) end),
      'combo', p.combo,
      'deck', p.deck,
      'achievement', p.achievement,
      'visibility', p.visibility,
      'at', p.created_at,
      'mine', p.author = auth.uid(),
      'likes', (select count(*)
        from public.post_likes l
       where l.post_id = p.id),
      'liked', exists (select 1
        from public.post_likes l
       where l.post_id = p.id
         and l.user_id = auth.uid()),
      'comments_n', (select count(*)
        from public.post_comments c
       where c.post_id = p.id
         and not c.hidden
         and not c.deleted),
      'comments', coalesce((
        select jsonb_agg(x.j order by x.at)
          from (
          select c.created_at at,
                 private.comment_json(c) j
            from public.post_comments c
           where c.post_id = p.id
             and not c.hidden
             and not c.deleted
           order by c.created_at desc
           limit 3) x), '[]'::jsonb));
$$;

-- all of a post's comments, each reply
-- right under its first comment
create or replace function
  public.post_comments_all(p_post uuid)
returns jsonb
language plpgsql stable security definer
set search_path = '' as $$
declare p public.posts;
begin
  select * into p from public.posts
   where id = p_post;
  if p.id is null
     or not private.sees_post(p) then
    return null;
  end if;
  return coalesce((
    select jsonb_agg(
      private.comment_json(c)
      order by coalesce(t.created_at,
          c.created_at),
        c.reply_to is not null,
        c.created_at)
      from public.post_comments c
      left join public.post_comments t
        on t.id = c.reply_to
     where c.post_id = p.id
       and not c.hidden), '[]'::jsonb);
end $$;

-- comment, or reply (p_reply: the comment
-- being answered)
drop function if exists
  public.comment_post(uuid, text);
create or replace function
  public.comment_post(
    p_post uuid, p_body text,
    p_reply uuid default null)
returns jsonb
language plpgsql security definer
set search_path = '' as $$
declare p public.posts;
  t public.post_comments; cid uuid;
begin
  perform private.need_adult();
  select * into p from public.posts
   where id = p_post;
  if p.id is null
     or not private.sees_post(p) then
    raise exception 'not allowed'
      using errcode = '42501';
  end if;
  if p_reply is not null then
    select * into t
      from public.post_comments
     where id = p_reply
       and post_id = p.id
       and not hidden and not deleted;
    if t.id is null then
      raise exception 'bad_reply';
    end if;
  end if;
  if (select count(*)
        from public.post_comments
       where author = auth.uid()
         and created_at
           > now() - interval '1 day')
     >= 100 then
    raise exception 'too many comments';
  end if;
  insert into public.post_comments
    (post_id, author, body, reply_to,
     reply_user)
  values (p.id, auth.uid(),
    btrim(coalesce(p_body, '')),
    coalesce(t.reply_to, t.id),
    t.author)
  returning id into cid;
  if t.id is not null then
    perform private.notify(t.author,
      'reply', jsonb_build_object(
        'post', p.id, 'comment', cid));
  end if;
  if t.id is null
     or t.author is distinct from p.author
  then
    perform private.notify(p.author,
      'comment', jsonb_build_object(
        'post', p.id, 'comment', cid));
  end if;
  return private.post_json(p);
end $$;
revoke all on function public.comment_post(
  uuid, text, uuid) from public, anon;
grant execute on function
  public.comment_post(uuid, text, uuid)
  to authenticated;

create or replace function
  public.like_comment(
    p_comment uuid, p_on boolean default true)
returns void
language plpgsql security definer
set search_path = '' as $$
declare c public.post_comments;
  p public.posts;
begin
  if auth.uid() is null then
    raise exception 'authentication_required'
      using errcode = '42501';
  end if;
  select * into c from public.post_comments
   where id = p_comment;
  select * into p from public.posts
   where id = c.post_id;
  if c.id is null or c.hidden or c.deleted
     or not private.sees_post(p) then
    raise exception 'not allowed'
      using errcode = '42501';
  end if;
  if coalesce(p_on, true) then
    insert into public.comment_likes
      (comment_id, user_id)
    values (c.id, auth.uid())
    on conflict do nothing;
    if found then
      perform private.notify(c.author,
        'comment_like', jsonb_build_object(
          'post', p.id, 'comment', c.id));
    end if;
  else
    delete from public.comment_likes
     where comment_id = c.id
       and user_id = auth.uid();
  end if;
end $$;
revoke all on function public.like_comment(
  uuid, boolean) from public, anon;
grant execute on function
  public.like_comment(uuid, boolean)
  to authenticated;

-- a liked comment: the bell only, no phone
create or replace function
  private.push_notify()
returns trigger
language plpgsql security definer
set search_path = '' as $$
begin
  if new.kind <> 'comment_like'
     and exists (select 1
       from public.push_subs
      where user_id = new.user_id) then
    perform net.http_post(
      url := 'https://sorefaetiaebmjploanp'
        || '.supabase.co/functions/v1/'
        || 'push-send',
      body := jsonb_build_object(
        'id', new.id),
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-push-key', private.push_key()));
  end if;
  return new;
end $$;

-- author deletes; site admin hides or
-- deletes. A comment with replies stays as
-- "comentário apagado" (its text is erased).
create or replace function
  public.moderate_post(
    p_action text,
    p_post uuid default null,
    p_comment uuid default null)
returns void
language plpgsql security definer
set search_path = '' as $$
declare a uuid; pa uuid; par uuid;
begin
  if auth.uid() is null then
    raise exception 'authentication_required'
      using errcode = '42501';
  end if;
  if p_comment is not null then
    select c.author, p.author into a, pa
      from public.post_comments c
      join public.posts p on p.id = c.post_id
     where c.id = p_comment;
    if p_action = 'delete' and (a = auth.uid()
         or pa = auth.uid()
         or private.is_admin()) then
      if exists (select 1
           from public.post_comments
          where reply_to = p_comment) then
        update public.post_comments
           set deleted = true, body = '·'
         where id = p_comment;
        delete from public.comment_likes
         where comment_id = p_comment;
      else
        delete from public.post_comments
         where id = p_comment
        returning reply_to into par;
        -- its first comment was deleted
        -- and had only this reply left
        delete from public.post_comments x
         where x.id = par and x.deleted
           and not exists (select 1
             from public.post_comments y
            where y.reply_to = par);
      end if;
    elsif p_action = 'hide'
          and private.is_admin() then
      update public.post_comments
         set hidden = true
       where id = p_comment;
    else
      raise exception 'not allowed'
        using errcode = '42501';
    end if;
    return;
  end if;
  select author into a from public.posts
   where id = p_post;
  if p_action = 'delete' and (a = auth.uid()
       or private.is_admin()) then
    delete from public.posts where id = p_post;
  elsif p_action = 'hide'
        and private.is_admin() then
    update public.posts set hidden = true
     where id = p_post;
  else
    raise exception 'not allowed'
      using errcode = '42501';
  end if;
end $$;

-- "Baixar meus dados": + comment likes
do $$
declare d text;
begin
  d := pg_get_functiondef(
    'public.my_data_export()'::regprocedure);
  if position('comment_likes' in d) = 0
  then
    d := regexp_replace(d,
      '''\[\]''\)\);(\s*end)',
      '''[]''),' || chr(10)
      || '    ''comment_likes'', coalesce(('
      || chr(10)
      || '      select jsonb_agg(to_jsonb(x))'
      || chr(10)
      || '        from public.comment_likes x'
      || chr(10)
      || '       where x.user_id = u),'
      || ' ''[]''));' || '\1');
    execute d;
  end if;
end $$;
