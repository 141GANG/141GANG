-- 141GANG blocker-fix: authenticated users may submit games and media.
-- Moderation, publication and deletion of other users' content remain admin-only.
-- Applied to production on 2026-08-30.

create or replace function public.submit_game_suggestion(
  p_steam_app_id bigint,
  p_title text,
  p_cover_url text default '',
  p_description text default '',
  p_comment text default '',
  p_release_date date default null,
  p_release_date_text text default '',
  p_coming_soon boolean default false,
  p_is_coop boolean default false,
  p_coop_min_players integer default null,
  p_coop_max_players integer default null,
  p_players_min integer default 1,
  p_players_max integer default 1,
  p_player_count_source text default ''
)
returns table (
  suggestion_id bigint,
  suggestion_status text,
  was_created boolean,
  support_count bigint
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_suggestion public.game_suggestions;
  v_created boolean := false;
  v_comment text := btrim(coalesce(p_comment, ''));
  v_players_min integer := greatest(1, least(256, coalesce(p_players_min, 1)));
  v_players_max integer;
  v_coop_min integer;
  v_coop_max integer;
begin
  if v_user_id is null or coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) then
    raise exception 'Требуется авторизация.' using errcode = '42501';
  end if;
  if p_steam_app_id is null or p_steam_app_id <= 0 then raise exception 'Некорректный Steam App ID.'; end if;
  if char_length(btrim(coalesce(p_title, ''))) not between 1 and 120 then raise exception 'Некорректное название игры.'; end if;
  if char_length(coalesce(p_cover_url, '')) > 1000
    or char_length(coalesce(p_description, '')) > 2000
    or char_length(v_comment) > 300
    or char_length(coalesce(p_release_date_text, '')) > 120
    or char_length(coalesce(p_player_count_source, '')) > 120 then
    raise exception 'Слишком длинные данные предложения.';
  end if;

  v_players_max := greatest(v_players_min, least(256, coalesce(p_players_max, v_players_min)));
  v_coop_min := case when p_coop_min_players between 1 and 256 then p_coop_min_players else null end;
  v_coop_max := case when p_coop_max_players between 1 and 256 then p_coop_max_players else null end;
  if v_coop_min is not null and v_coop_max is not null and v_coop_max < v_coop_min then v_coop_max := v_coop_min; end if;

  perform pg_catalog.pg_advisory_xact_lock(p_steam_app_id);
  select * into v_suggestion from public.game_suggestions where steam_app_id = p_steam_app_id for update;

  if not found then
    if (select count(*) from public.game_suggestions where submitted_by = v_user_id and created_at >= now() - interval '24 hours') >= 5 then
      raise exception 'Можно предложить не больше пяти новых игр за 24 часа.';
    end if;

    insert into public.game_suggestions (
      steam_app_id, steam_url, title, cover_url, description, submitted_by,
      release_date, release_date_text, coming_soon, is_coop,
      coop_min_players, coop_max_players, players_min, players_max,
      player_count_source, steam_snapshot_synced_at
    ) values (
      p_steam_app_id,
      'https://store.steampowered.com/app/' || p_steam_app_id || '/',
      btrim(p_title), coalesce(p_cover_url, ''), coalesce(p_description, ''), v_user_id,
      p_release_date, left(coalesce(p_release_date_text, ''), 120), coalesce(p_coming_soon, false), coalesce(p_is_coop, false),
      v_coop_min, v_coop_max, v_players_min, v_players_max,
      left(coalesce(p_player_count_source, ''), 120), now()
    ) returning * into v_suggestion;
    v_created := true;
  elsif v_suggestion.status in ('pending', 'approved', 'selected')
    and (v_suggestion.submitted_by = v_user_id or public.is_site_admin()) then
    update public.game_suggestions
       set title = btrim(p_title),
           cover_url = coalesce(p_cover_url, ''),
           description = coalesce(p_description, ''),
           release_date = p_release_date,
           release_date_text = left(coalesce(p_release_date_text, ''), 120),
           coming_soon = coalesce(p_coming_soon, false),
           is_coop = coalesce(p_is_coop, false),
           coop_min_players = v_coop_min,
           coop_max_players = v_coop_max,
           players_min = v_players_min,
           players_max = v_players_max,
           player_count_source = left(coalesce(p_player_count_source, ''), 120),
           steam_snapshot_synced_at = now()
     where id = v_suggestion.id
     returning * into v_suggestion;
  end if;

  if v_comment <> '' and v_suggestion.status in ('pending', 'approved', 'selected') then
    insert into public.suggestion_comments (suggestion_id, user_id, body)
    values (v_suggestion.id, v_user_id, v_comment)
    on conflict on constraint suggestion_comments_suggestion_id_user_id_key
    do update set body = excluded.body, is_hidden = false, updated_at = now();
  end if;

  return query select v_suggestion.id, v_suggestion.status, v_created, 0::bigint;
end;
$$;

revoke execute on function public.submit_game_suggestion(bigint, text, text, text, text, date, text, boolean, boolean, integer, integer, integer, integer, text) from public, anon;
grant execute on function public.submit_game_suggestion(bigint, text, text, text, text, date, text, boolean, boolean, integer, integer, integer, integer, text) to authenticated;

-- Media submission row: only a real signed-in user may create their own pending row.
drop policy if exists "Media submissions admin insert" on public.media_submissions;
drop policy if exists "Media submissions authenticated insert" on public.media_submissions;
create policy "Media submissions authenticated insert"
on public.media_submissions
for insert
to authenticated
with check (
  auth.uid() is not null
  and not coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false)
  and created_by = auth.uid()
  and status = 'pending'
  and moderated_by is null
  and moderated_at is null
  and published_at is null
  and archived_at is null
);

drop policy if exists "Media submissions own pending read" on public.media_submissions;
create policy "Media submissions own pending read"
on public.media_submissions
for select
to authenticated
using (
  auth.uid() is not null
  and not coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false)
  and created_by = auth.uid()
  and status = 'pending'
);

drop policy if exists "Media submissions own pending delete" on public.media_submissions;
create policy "Media submissions own pending delete"
on public.media_submissions
for delete
to authenticated
using (
  auth.uid() is not null
  and not coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false)
  and created_by = auth.uid()
  and status = 'pending'
);

-- Media file metadata follows ownership of the pending submission.
drop policy if exists "Media files admin insert" on public.media_submission_files;
drop policy if exists "Media files authenticated insert" on public.media_submission_files;
create policy "Media files authenticated insert"
on public.media_submission_files
for insert
to authenticated
with check (
  auth.uid() is not null
  and not coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false)
  and created_by = auth.uid()
  and exists (
    select 1
    from public.media_submissions submission
    where submission.id = submission_id
      and submission.created_by = auth.uid()
      and submission.status = 'pending'
  )
);

drop policy if exists "Media files own pending read" on public.media_submission_files;
create policy "Media files own pending read"
on public.media_submission_files
for select
to authenticated
using (
  auth.uid() is not null
  and not coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false)
  and created_by = auth.uid()
  and exists (
    select 1
    from public.media_submissions submission
    where submission.id = submission_id
      and submission.created_by = auth.uid()
      and submission.status = 'pending'
  )
);

drop policy if exists "Media files own pending delete" on public.media_submission_files;
create policy "Media files own pending delete"
on public.media_submission_files
for delete
to authenticated
using (
  auth.uid() is not null
  and not coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false)
  and created_by = auth.uid()
  and exists (
    select 1
    from public.media_submissions submission
    where submission.id = submission_id
      and submission.created_by = auth.uid()
      and submission.status = 'pending'
  )
);

-- Private Storage bucket: own pending uploads for authenticated users.
drop policy if exists "Media bucket admin upload" on storage.objects;
drop policy if exists "Media bucket authenticated upload" on storage.objects;
create policy "Media bucket authenticated upload"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'stream-submissions'
  and auth.uid() is not null
  and not coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false)
  and (storage.foldername(name))[1] = auth.uid()::text
  and exists (
    select 1
    from public.media_submissions submission
    where submission.id::text = (storage.foldername(name))[2]
      and submission.created_by = auth.uid()
      and submission.status = 'pending'
  )
);

drop policy if exists "Media bucket own pending read" on storage.objects;
create policy "Media bucket own pending read"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'stream-submissions'
  and auth.uid() is not null
  and not coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false)
  and (storage.foldername(name))[1] = auth.uid()::text
  and exists (
    select 1
    from public.media_submissions submission
    where submission.id::text = (storage.foldername(name))[2]
      and submission.created_by = auth.uid()
      and submission.status = 'pending'
  )
);

drop policy if exists "Media bucket own pending delete" on storage.objects;
create policy "Media bucket own pending delete"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'stream-submissions'
  and auth.uid() is not null
  and not coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false)
  and (storage.foldername(name))[1] = auth.uid()::text
  and exists (
    select 1
    from public.media_submissions submission
    where submission.id::text = (storage.foldername(name))[2]
      and submission.created_by = auth.uid()
      and submission.status = 'pending'
  )
);
