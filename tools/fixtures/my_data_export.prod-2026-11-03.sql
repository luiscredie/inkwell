CREATE OR REPLACE FUNCTION public.my_data_export()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare u uuid := auth.uid();
begin
  return private.my_data_export_base()
    || jsonb_build_object(
    'collection_shares', coalesce((
      select jsonb_agg(to_jsonb(x))
        from public.collection_shares x
       where u in (x.owner, x.member)),
      '[]'),
    'collection_share_links', coalesce((
      select jsonb_agg(to_jsonb(x))
        from public.collection_share_invites x
       where x.owner = u), '[]'),
    'collection_privacy', (
      select to_jsonb(x)
        from public.collection_privacy x
       where x.user_id = u),
    'cards_in_trade_binder', coalesce((
      select jsonb_agg(to_jsonb(x))
        from public.collection_trade x
       where x.user_id = u), '[]'),
    'cards_in_built_decks', coalesce((
      select jsonb_agg(to_jsonb(x))
        from public.collection_decked x
       where x.user_id = u), '[]'),
    'achievements', coalesce((
      select jsonb_agg(to_jsonb(x))
        from public.achievements x
       where x.user_id = u), '[]'),
    'comment_likes', coalesce((
      select jsonb_agg(to_jsonb(x))
        from public.comment_likes x
       where x.user_id = u), '[]'),
    'feedback_sent', coalesce((
      select jsonb_agg(jsonb_build_object('kind', x.kind, 'body', x.body, 'at', x.created_at))
        from private.feedback x
       where x.user_id = u), '[]'));
end $function$
;
