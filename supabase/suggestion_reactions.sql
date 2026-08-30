-- Миграция рейтинга предложки: поддержки и голоса заменяются лайками/дизлайками.
-- Выполни файл целиком в Supabase SQL Editor.
-- Существующие голоса безопасно превращаются в лайки.

begin;

alter table public.suggestion_votes
  add column if not exists reaction smallint;
update public.suggestion_votes set reaction = 1 where reaction is null;
alter table public.suggestion_votes
  alter column reaction set default 1,
  alter column reaction set not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'suggestion_votes_reaction_check'
      and conrelid = 'public.suggestion_votes'::regclass
  ) then
    alter table public.suggestion_votes
      add constraint suggestion_votes_reaction_check check (reaction in (-1, 1));
  end if;
end $$;

create or replace function public.submit_game_suggestion(
  p_steam_app_id bigint,
  p_title text,
  p_cover_url text default '',
  p_description text default '',
  p_comment text default ''
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
begin
  if v_user_id is null then
    raise exception 'Требуется авторизация администратора.';
  end if;
  if not public.is_site_admin() then
    raise exception 'Предлагать игры может только администратор.';
  end if;
  if p_steam_app_id is null or p_steam_app_id <= 0 then
    raise exception 'Некорректный Steam App ID.';
  end if;
  if char_length(btrim(coalesce(p_title, ''))) not between 1 and 120 then
    raise exception 'Некорректное название игры.';
  end if;
  if char_length(coalesce(p_cover_url, '')) > 1000
    or char_length(coalesce(p_description, '')) > 2000
    or char_length(v_comment) > 300 then
    raise exception 'Слишком длинные данные предложения.';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(p_steam_app_id);

  select *
    into v_suggestion
    from public.game_suggestions
   where steam_app_id = p_steam_app_id
   for update;

  if not found then
    if (
      select count(*)
      from public.game_suggestions
      where submitted_by = v_user_id
        and created_at >= now() - interval '24 hours'
    ) >= 5 then
      raise exception 'Можно предложить не больше пяти новых игр за 24 часа.';
    end if;

    insert into public.game_suggestions (
      steam_app_id, steam_url, title, cover_url, description, submitted_by
    )
    values (
      p_steam_app_id,
      'https://store.steampowered.com/app/' || p_steam_app_id || '/',
      btrim(p_title),
      coalesce(p_cover_url, ''),
      coalesce(p_description, ''),
      v_user_id
    )
    returning * into v_suggestion;
    v_created := true;
  end if;

  if v_comment <> '' and v_suggestion.status in ('pending', 'approved', 'selected') then
    insert into public.suggestion_comments (suggestion_id, user_id, body)
    values (v_suggestion.id, v_user_id, v_comment)
    on conflict on constraint suggestion_comments_suggestion_id_user_id_key
    do update set body = excluded.body, is_hidden = false, updated_at = now();
  end if;

  return query
  select v_suggestion.id, v_suggestion.status, v_created, 0::bigint;
end;
$$;

drop function if exists public.get_public_game_suggestions();
create function public.get_public_game_suggestions()
returns table (
  id bigint,
  steam_app_id bigint,
  steam_url text,
  title text,
  cover_url text,
  description text,
  status text,
  created_at timestamptz,
  like_count bigint,
  dislike_count bigint,
  reaction_count bigint,
  approval_percent numeric,
  comment_count bigint,
  my_reaction smallint,
  my_comment text
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    g.id,
    g.steam_app_id,
    g.steam_url,
    g.title,
    g.cover_url,
    g.description,
    g.status,
    g.created_at,
    stats.like_count,
    stats.dislike_count,
    stats.like_count + stats.dislike_count,
    case
      when stats.like_count + stats.dislike_count = 0 then 0::numeric
      else round(100.0 * stats.like_count / (stats.like_count + stats.dislike_count), 1)
    end,
    (select count(*) from public.suggestion_comments c where c.suggestion_id = g.id and not c.is_hidden),
    coalesce((
      select v.reaction from public.suggestion_votes v
      where v.suggestion_id = g.id and v.user_id = auth.uid()
      limit 1
    ), 0)::smallint,
    coalesce((
      select c.body from public.suggestion_comments c
      where c.suggestion_id = g.id and c.user_id = auth.uid()
      limit 1
    ), '')
  from public.game_suggestions g
  cross join lateral (
    select
      count(*) filter (where v.reaction = 1)::bigint as like_count,
      count(*) filter (where v.reaction = -1)::bigint as dislike_count
    from public.suggestion_votes v
    where v.suggestion_id = g.id
  ) stats
  where g.status in ('approved', 'selected')
  order by
    (g.status = 'selected') desc,
    case
      when stats.like_count + stats.dislike_count = 0 then 0::numeric
      else 100.0 * stats.like_count / (stats.like_count + stats.dislike_count)
    end desc,
    (stats.like_count + stats.dislike_count) desc,
    stats.like_count desc,
    g.created_at asc;
$$;

drop function if exists public.toggle_suggestion_vote(bigint);
drop function if exists public.set_suggestion_reaction(bigint, smallint);
create function public.set_suggestion_reaction(
  p_suggestion_id bigint,
  p_reaction smallint
)
returns table (
  current_reaction smallint,
  like_count bigint,
  dislike_count bigint,
  approval_percent numeric
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_previous smallint;
  v_current smallint;
begin
  if v_user_id is null then raise exception 'Требуется авторизация зрителя.'; end if;
  if p_reaction is null or p_reaction not in (-1, 1) then
    raise exception 'Реакция должна быть лайком или дизлайком.';
  end if;
  if not exists (
    select 1 from public.game_suggestions
    where id = p_suggestion_id and status = 'approved'
  ) then
    raise exception 'Оценка этой игры закрыта.';
  end if;

  select v.reaction
    into v_previous
    from public.suggestion_votes v
   where v.suggestion_id = p_suggestion_id
     and v.user_id = v_user_id;

  if v_previous = p_reaction then
    delete from public.suggestion_votes
     where suggestion_id = p_suggestion_id
       and user_id = v_user_id;
    v_current := 0;
  else
    insert into public.suggestion_votes (suggestion_id, user_id, reaction)
    values (p_suggestion_id, v_user_id, p_reaction)
    on conflict (suggestion_id, user_id)
    do update set reaction = excluded.reaction;
    v_current := p_reaction;
  end if;

  return query
  with totals as (
    select
      count(*) filter (where v.reaction = 1)::bigint as likes,
      count(*) filter (where v.reaction = -1)::bigint as dislikes
    from public.suggestion_votes v
    where v.suggestion_id = p_suggestion_id
  )
  select
    v_current,
    totals.likes,
    totals.dislikes,
    case
      when totals.likes + totals.dislikes = 0 then 0::numeric
      else round(100.0 * totals.likes / (totals.likes + totals.dislikes), 1)
    end
  from totals;
end;
$$;

revoke all on function public.get_public_game_suggestions() from public;
revoke all on function public.set_suggestion_reaction(bigint, smallint) from public;
grant execute on function public.get_public_game_suggestions() to anon, authenticated;
grant execute on function public.set_suggestion_reaction(bigint, smallint) to authenticated;

notify pgrst, 'reload schema';

commit;
