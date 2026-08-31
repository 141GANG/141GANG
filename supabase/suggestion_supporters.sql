-- 141GANG: distinct proposal supporters + admin supporter comments
-- One Steam game stays one game_suggestions row; each authenticated proposer
-- is recorded once in suggestion_supporters, independently of whether they
-- left a comment. Public like/dislike reactions remain separate.

create table if not exists public.suggestion_supporters (
  suggestion_id bigint not null references public.game_suggestions(id) on delete cascade,
  user_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (suggestion_id, user_id)
);

create index if not exists suggestion_supporters_user_id_idx
  on public.suggestion_supporters (user_id);

alter table public.suggestion_supporters enable row level security;
revoke all on table public.suggestion_supporters from public, anon, authenticated;

-- Historical recovery. The original submitter is always a supporter.
insert into public.suggestion_supporters (suggestion_id, user_id, created_at)
select g.id, g.submitted_by, g.created_at
from public.game_suggestions g
where g.submitted_by is not null
on conflict (suggestion_id, user_id) do nothing;

-- Pending comments could only have been submitted with the proposal. For
-- already moderated rows, only comments that existed by moderation time are
-- considered historical proposal comments; later public discussion is not.
insert into public.suggestion_supporters (suggestion_id, user_id, created_at)
select c.suggestion_id, c.user_id, least(c.created_at, g.created_at)
from public.suggestion_comments c
join public.game_suggestions g on g.id = c.suggestion_id
where g.status = 'pending'
   or g.moderated_at is null
   or c.created_at <= g.moderated_at + interval '5 seconds'
on conflict (suggestion_id, user_id) do nothing;

create or replace function public.submit_game_suggestion(
  p_steam_app_id bigint,
  p_title text,
  p_cover_url text default ''::text,
  p_description text default ''::text,
  p_comment text default ''::text,
  p_release_date date default null::date,
  p_release_date_text text default ''::text,
  p_coming_soon boolean default false,
  p_is_coop boolean default false,
  p_coop_min_players integer default null::integer,
  p_coop_max_players integer default null::integer,
  p_players_min integer default 1,
  p_players_max integer default 1,
  p_player_count_source text default ''::text
)
returns table(
  suggestion_id bigint,
  suggestion_status text,
  was_created boolean,
  support_count bigint
)
language plpgsql
security definer
set search_path to ''
as $function$
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
  if p_steam_app_id is null or p_steam_app_id <= 0 then
    raise exception 'Некорректный Steam App ID.';
  end if;
  if char_length(btrim(coalesce(p_title, ''))) not between 1 and 120 then
    raise exception 'Некорректное название игры.';
  end if;
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
  if v_coop_min is not null and v_coop_max is not null and v_coop_max < v_coop_min then
    v_coop_max := v_coop_min;
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
    )
    returning * into v_suggestion;
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

  if v_suggestion.status in ('pending', 'approved', 'selected') then
    insert into public.suggestion_supporters (suggestion_id, user_id)
    values (v_suggestion.id, v_user_id)
    on conflict on constraint suggestion_supporters_pkey do nothing;
  end if;

  if v_comment <> '' and v_suggestion.status in ('pending', 'approved', 'selected') then
    insert into public.suggestion_comments (suggestion_id, user_id, body)
    values (v_suggestion.id, v_user_id, v_comment)
    on conflict on constraint suggestion_comments_suggestion_id_user_id_key
    do update set body = excluded.body, is_hidden = false, updated_at = now();
  end if;

  return query
  select
    v_suggestion.id,
    v_suggestion.status,
    v_created,
    (select count(*) from public.suggestion_supporters s where s.suggestion_id = v_suggestion.id)::bigint;
end;
$function$;

create or replace function public.get_admin_suggestion_support_counts()
returns table(
  suggestion_id bigint,
  support_count bigint,
  supporter_comment_count bigint
)
language plpgsql
stable
security definer
set search_path to ''
as $function$
begin
  if not public.is_site_admin() then
    raise exception 'Это действие доступно только администратору.' using errcode = '42501';
  end if;

  return query
  select
    g.id as suggestion_id,
    count(distinct s.user_id)::bigint as support_count,
    count(distinct c.user_id)::bigint as supporter_comment_count
  from public.game_suggestions g
  left join public.suggestion_supporters s
    on s.suggestion_id = g.id
  left join public.suggestion_comments c
    on c.suggestion_id = g.id
   and c.user_id = s.user_id
   and btrim(c.body) <> ''
  group by g.id;
end;
$function$;

create or replace function public.get_admin_suggestion_support_comments(p_suggestion_id bigint)
returns table(
  comment_id bigint,
  body text,
  is_hidden boolean,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
stable
security definer
set search_path to ''
as $function$
begin
  if not public.is_site_admin() then
    raise exception 'Это действие доступно только администратору.' using errcode = '42501';
  end if;

  return query
  select
    c.id as comment_id,
    c.body,
    c.is_hidden,
    c.created_at,
    c.updated_at
  from public.suggestion_supporters s
  join public.suggestion_comments c
    on c.suggestion_id = s.suggestion_id
   and c.user_id = s.user_id
  where s.suggestion_id = p_suggestion_id
    and btrim(c.body) <> ''
  order by c.created_at asc, c.id asc;
end;
$function$;

revoke all on function public.get_admin_suggestion_support_counts() from public;
revoke all on function public.get_admin_suggestion_support_comments(bigint) from public;
grant execute on function public.get_admin_suggestion_support_counts() to authenticated;
grant execute on function public.get_admin_suggestion_support_comments(bigint) to authenticated;

-- Catalog-style author names for the admin-only proposer comment viewer.
create or replace function public.get_admin_suggestion_support_comments_v2(p_suggestion_id bigint)
returns table(
  comment_id bigint,
  username text,
  body text,
  is_hidden boolean,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_site_admin() then
    raise exception 'Это действие доступно только администратору.' using errcode = '42501';
  end if;

  return query
  select
    c.id as comment_id,
    coalesce(
      nullif(u.raw_user_meta_data ->> 'preferred_username', ''),
      nullif(u.raw_user_meta_data ->> 'full_name', ''),
      nullif(u.raw_user_meta_data ->> 'name', ''),
      split_part(coalesce(u.email, 'Пользователь'), '@', 1)
    )::text as username,
    c.body,
    c.is_hidden,
    c.created_at,
    c.updated_at
  from public.suggestion_supporters s
  join public.suggestion_comments c
    on c.suggestion_id = s.suggestion_id
   and c.user_id = s.user_id
  left join auth.users u
    on u.id = c.user_id
  where s.suggestion_id = p_suggestion_id
    and btrim(c.body) <> ''
  order by c.created_at asc, c.id asc;
end;
$$;

revoke all on function public.get_admin_suggestion_support_comments_v2(bigint) from public, anon;
grant execute on function public.get_admin_suggestion_support_comments_v2(bigint) to authenticated;
