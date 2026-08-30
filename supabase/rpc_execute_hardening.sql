-- Release hardening: normalize RPC EXECUTE privileges.
-- Supabase may grant EXECUTE to anon/authenticated through default privileges
-- when SECURITY DEFINER functions are created or replaced. Keep the actual
-- production ACL aligned with the intended grants declared in project SQL.

-- Start from a closed state for browser roles.
revoke execute on function public.add_game_comment(bigint, text) from anon, authenticated;
revoke execute on function public.delete_game_suggestion(bigint) from anon, authenticated;
revoke execute on function public.delete_my_suggestion_comment(bigint) from anon, authenticated;
revoke execute on function public.get_game_interactions(bigint) from anon, authenticated;
revoke execute on function public.get_game_vote_scores() from anon, authenticated;
revoke execute on function public.get_my_game_votes() from anon, authenticated;
revoke execute on function public.get_public_game_suggestions() from anon, authenticated;
revoke execute on function public.get_public_suggestion_comments(bigint) from anon, authenticated;
revoke execute on function public.is_site_admin() from anon, authenticated;
revoke execute on function public.moderate_game_suggestion(bigint, text, text) from anon, authenticated;
revoke execute on function public.moderate_suggestion_comment(bigint, boolean) from anon, authenticated;
revoke execute on function public.set_game_reaction(bigint, smallint) from anon, authenticated;
revoke execute on function public.set_suggestion_reaction(bigint, smallint) from anon, authenticated;
revoke execute on function public.submit_game_suggestion(bigint, text, text, text, text, date, text, boolean, boolean, integer, integer, integer, integer, text) from anon, authenticated;
revoke execute on function public.upsert_suggestion_comment(bigint, text) from anon, authenticated;
revoke execute on function public.vote_game(bigint, smallint) from anon, authenticated;

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

notify pgrst, 'reload schema';
