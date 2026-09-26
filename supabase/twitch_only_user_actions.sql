-- Require a Twitch identity for public proposals and like/dislike actions.
-- Site administrators and the service role keep their moderation access.

begin;

create or replace function public.has_twitch_identity()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select auth.uid() is not null
    and not coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false)
    and (
      lower(coalesce(auth.jwt() -> 'app_metadata' ->> 'provider', '')) = 'twitch'
      or coalesce(auth.jwt() -> 'app_metadata' -> 'providers', '[]'::jsonb) ? 'twitch'
      or exists (
        select 1
        from auth.identities identity
        where identity.user_id = auth.uid()
          and lower(identity.provider) = 'twitch'
      )
    );
$$;

revoke all on function public.has_twitch_identity() from public, anon;
grant execute on function public.has_twitch_identity() to authenticated;

create or replace function public.enforce_twitch_user_action()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null
    or auth.role() = 'service_role'
    or public.is_site_admin()
    or public.has_twitch_identity() then
    if tg_op = 'DELETE' then
      return old;
    end if;
    return new;
  end if;

  raise exception 'Требуется авторизация через Twitch.' using errcode = '42501';
end;
$$;

revoke all on function public.enforce_twitch_user_action() from public, anon, authenticated;

drop trigger if exists game_suggestions_require_twitch on public.game_suggestions;
create trigger game_suggestions_require_twitch
before insert or update on public.game_suggestions
for each row execute function public.enforce_twitch_user_action();

drop trigger if exists media_submissions_require_twitch on public.media_submissions;
create trigger media_submissions_require_twitch
before insert on public.media_submissions
for each row execute function public.enforce_twitch_user_action();

drop trigger if exists game_votes_require_twitch on public.game_votes;
create trigger game_votes_require_twitch
before insert or update or delete on public.game_votes
for each row execute function public.enforce_twitch_user_action();

drop trigger if exists suggestion_votes_require_twitch on public.suggestion_votes;
create trigger suggestion_votes_require_twitch
before insert or update or delete on public.suggestion_votes
for each row execute function public.enforce_twitch_user_action();

commit;

notify pgrst, 'reload schema';
