-- Release hardening: normalize RPC EXECUTE privileges.
-- Supabase may grant EXECUTE to anon/authenticated through default privileges
-- when SECURITY DEFINER functions are created or replaced. Keep the actual
-- production ACL aligned with the intended grants declared in project SQL.

-- Start from a closed state for browser roles.
revoke execute on function public.add_game_comment(bigint, text) from public, anon, authenticated;
revoke execute on function public.delete_game_suggestion(bigint) from public, anon, authenticated;
revoke execute on function public.delete_my_suggestion_comment(bigint) from public, anon, authenticated;
revoke execute on function public.get_game_interactions(bigint) from public, anon, authenticated;
revoke execute on function public.get_game_vote_scores() from public, anon, authenticated;
revoke execute on function public.get_my_game_votes() from public, anon, authenticated;
revoke execute on function public.get_public_game_suggestions() from public, anon, authenticated;
revoke execute on function public.get_public_suggestion_comments(bigint) from public, anon, authenticated;
revoke execute on function public.is_site_admin() from public, anon, authenticated;
revoke execute on function public.moderate_game_suggestion(bigint, text, text) from public, anon, authenticated;
revoke execute on function public.moderate_suggestion_comment(bigint, boolean) from public, anon, authenticated;
revoke execute on function public.set_game_reaction(bigint, smallint) from public, anon, authenticated;
revoke execute on function public.set_suggestion_reaction(bigint, smallint) from public, anon, authenticated;
revoke execute on function public.submit_game_suggestion(bigint, text, text, text, text, date, text, boolean, boolean, integer, integer, integer, integer, text) from public, anon, authenticated;
revoke execute on function public.upsert_suggestion_comment(bigint, text) from public, anon, authenticated;
revoke execute on function public.vote_game(bigint, smallint) from public, anon, authenticated;
revoke execute on function public.update_game_comment(bigint, text) from public, anon, authenticated;
revoke execute on function public.delete_game_comment(bigint) from public, anon, authenticated;
revoke execute on function public.set_game_comment_reaction(bigint, smallint) from public, anon, authenticated;
revoke execute on function public.get_admin_suggestion_support_counts() from public, anon, authenticated;
revoke execute on function public.get_admin_suggestion_support_comments(bigint) from public, anon, authenticated;
revoke execute on function public.get_admin_suggestion_support_comments_v2(bigint) from public, anon, authenticated;
revoke execute on function public.get_media_submission_authors() from public, anon, authenticated;
revoke execute on function public.get_donationalerts_connection_status() from public, anon, authenticated;

-- Public read-only RPCs used by the catalog/suggestion views.
grant execute on function public.get_game_interactions(bigint) to anon, authenticated;
grant execute on function public.get_game_vote_scores() to anon, authenticated;
grant execute on function public.get_public_game_suggestions() to anon, authenticated;
grant execute on function public.get_public_suggestion_comments(bigint) to anon, authenticated;

-- Signed-in actions. Their function bodies enforce ownership/admin rules.
grant execute on function public.add_game_comment(bigint, text) to authenticated;
grant execute on function public.delete_game_suggestion(bigint) to authenticated;
grant execute on function public.delete_my_suggestion_comment(bigint) to authenticated;
grant execute on function public.get_my_game_votes() to authenticated;
grant execute on function public.is_site_admin() to authenticated;
grant execute on function public.moderate_game_suggestion(bigint, text, text) to authenticated;
grant execute on function public.moderate_suggestion_comment(bigint, boolean) to authenticated;
grant execute on function public.set_game_reaction(bigint, smallint) to authenticated;
grant execute on function public.set_suggestion_reaction(bigint, smallint) to authenticated;
grant execute on function public.submit_game_suggestion(bigint, text, text, text, text, date, text, boolean, boolean, integer, integer, integer, integer, text) to authenticated;
grant execute on function public.upsert_suggestion_comment(bigint, text) to authenticated;
grant execute on function public.vote_game(bigint, smallint) to authenticated;
grant execute on function public.update_game_comment(bigint, text) to authenticated;
grant execute on function public.delete_game_comment(bigint) to authenticated;
grant execute on function public.set_game_comment_reaction(bigint, smallint) to authenticated;
grant execute on function public.get_admin_suggestion_support_counts() to authenticated;
grant execute on function public.get_admin_suggestion_support_comments(bigint) to authenticated;
grant execute on function public.get_admin_suggestion_support_comments_v2(bigint) to authenticated;
grant execute on function public.get_media_submission_authors() to authenticated;
grant execute on function public.get_donationalerts_connection_status() to authenticated;

notify pgrst, 'reload schema';
