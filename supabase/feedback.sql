-- "Enviar feedback": anyone (with or without
-- an account) tells us about a bug, an idea
-- or anything else. Admins read it on the
-- admin page (Feedback tab) and get a notice.
-- Kept: the text, the kind, the page, and —
-- only if the person leaves it on — the
-- browser and screen size; an e-mail only if
-- they type one. Handled ones go after 180
-- days.
-- Run once (safe to run again).

create table if not exists private.feedback (
  id uuid primary key
    default gen_random_uuid(),
  created_at timestamptz not null
    default now(),
  user_id uuid
    references auth.users(id)
    on delete set null,
  kind text not null
    check (kind in ('bug', 'idea', 'other')),
  body text not null
    check (length(btrim(body))
      between 3 and 2000),
  page text,
  path text,
  device text,
  email text,
  status text not null default 'open'
    check (status in ('open', 'done')),
  done_at timestamptz);
create index if not exists feedback_at
  on private.feedback (created_at desc);

create or replace function
  public.send_feedback(p_kind text,
    p_body text, p_page text, p_path text,
    p_device text, p_email text)
returns void
language plpgsql security definer
set search_path = '' as $$
declare u uuid := auth.uid(); b text;
begin
  b := btrim(coalesce(p_body, ''));
  if coalesce(p_kind, '') not in
       ('bug', 'idea', 'other')
     or length(b) not between 3 and 2000
  then
    raise exception 'bad_feedback';
  end if;
  -- enough is enough (no IP is kept, so
  -- visitors share one limit)
  if u is not null and (select count(*)
       from private.feedback
      where user_id = u
        and created_at
          > now() - interval '1 day') >= 10
     or u is null and (select count(*)
       from private.feedback
      where user_id is null
        and created_at
          > now() - interval '1 hour') >= 30
  then
    raise exception 'too_many';
  end if;
  insert into private.feedback (user_id,
    kind, body, page, path, device, email)
  values (u, p_kind, b,
    case when p_page ~ '^[a-z_-]{1,20}$'
      then p_page end,
    left(p_path, 200),
    left(p_device, 200),
    case when u is null and p_email
      ~ '^[^@\s]{1,64}@[^@\s]{1,100}\.\w+$'
      then left(p_email, 120) end);
  -- the admins' bell (and phone)
  insert into public.notifications
    (user_id, kind, actor, ref)
  select a.user_id, 'feedback', u,
    jsonb_build_object('fk', p_kind,
      'text', left(b, 80))
    from public.admins a
   where a.user_id is distinct from u;
end $$;
revoke all on function public.send_feedback(
  text, text, text, text, text, text)
  from public;
grant execute on function
  public.send_feedback(text, text, text,
    text, text, text)
  to anon, authenticated;

-- admins: the list, newest first
create or replace function
  public.admin_feedback()
returns jsonb
language plpgsql stable security definer
set search_path = '' as $$
begin
  if not private.is_admin() then
    raise exception 'not allowed'
      using errcode = '42501';
  end if;
  return coalesce((select jsonb_agg(
    jsonb_build_object('id', f.id,
      'at', f.created_at, 'kind', f.kind,
      'body', f.body, 'page', f.page,
      'path', f.path, 'device', f.device,
      'status', f.status,
      'email', coalesce(f.email, au.email),
      'name', p.display_name,
      'handle', case when p.is_public
        then p.handle end,
      'member', f.user_id is not null)
    order by f.status = 'done',
      f.created_at desc)
    from (select * from private.feedback
          order by created_at desc
          limit 300) f
    left join auth.users au
      on au.id = f.user_id
    left join public.profiles p
      on p.user_id = f.user_id),
    '[]'::jsonb);
end $$;
revoke all on function public.admin_feedback()
  from public, anon;
grant execute on function
  public.admin_feedback() to authenticated;

create or replace function
  public.admin_feedback_done(p_id uuid,
    p_done boolean)
returns void
language plpgsql security definer
set search_path = '' as $$
begin
  if not private.is_admin() then
    raise exception 'not allowed'
      using errcode = '42501';
  end if;
  update private.feedback
     set status = case when p_done
           then 'done' else 'open' end,
         done_at = case when p_done
           then now() end
   where id = p_id;
end $$;
revoke all on function
  public.admin_feedback_done(uuid, boolean)
  from public, anon;
grant execute on function
  public.admin_feedback_done(uuid, boolean)
  to authenticated;

-- handled ones go after 180 days
create or replace function
  private.trim_feedback()
returns void
language sql security definer
set search_path = '' as $$
  delete from private.feedback
   where status = 'done'
     and done_at < now() - interval '180 days';
$$;
select cron.unschedule('inkwell-trim-feedback')
 where exists (select 1 from cron.job
   where jobname = 'inkwell-trim-feedback');
select cron.schedule('inkwell-trim-feedback',
  '53 6 * * *',
  'select private.trim_feedback()');

-- "Baixar meus dados": + feedback sent
do $$
declare d text;
begin
  d := pg_get_functiondef(
    'public.my_data_export()'::regprocedure);
  if position('feedback_sent' in d) = 0
  then
    d := regexp_replace(d,
      '''\[\]''\)\);(\s*end)',
      '''[]''),' || chr(10)
      || '    ''feedback_sent'', coalesce(('
      || chr(10)
      || '      select jsonb_agg(jsonb_build_'
      || 'object(''kind'', x.kind, ''body'','
      || ' x.body, ''at'', x.created_at))'
      || chr(10)
      || '        from private.feedback x'
      || chr(10)
      || '       where x.user_id = u),'
      || ' ''[]''));' || '\1');
    execute d;
  end if;
end $$;
