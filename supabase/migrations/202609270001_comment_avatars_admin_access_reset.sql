-- 141GANG: Twitch avatars in comments and a one-time interaction reset.
-- Run once after game_comment_reactions.sql and suggestion_supporters.sql.

begin;

create table if not exists public.game_comment_reactions (
  comment_id bigint not null references public.game_comments(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  reaction smallint not null check (reaction in (-1, 1)),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (comment_id, user_id)
);

create index if not exists game_comment_reactions_comment_idx
  on public.game_comment_reactions (comment_id, reaction);

alter table public.game_comment_reactions enable row level security;
revoke all on table public.game_comment_reactions from anon, authenticated;

create or replace function public.set_game_comment_reaction(
  p_comment_id bigint,
  p_reaction smallint
)
returns table (
  current_reaction smallint,
  like_count bigint,
  dislike_count bigint,
  score bigint
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  viewer_id uuid := auth.uid();
  previous_reaction smallint;
  next_reaction smallint;
begin
  if viewer_id is null then
    raise exception 'Требуется авторизация.' using errcode = '42501';
  end if;
  if p_reaction not in (-1, 1) then
    raise exception 'Некорректная реакция.' using errcode = '22023';
  end if;
  if not exists (
    select 1
    from public.game_comments c
    join public.games g on g.id = c.game_id
    where c.id = p_comment_id and g.published = true
  ) then
    raise exception 'Комментарий не найден.' using errcode = 'P0002';
  end if;

  select r.reaction into previous_reaction
  from public.game_comment_reactions r
  where r.comment_id = p_comment_id and r.user_id = viewer_id;

  if previous_reaction = p_reaction then
    delete from public.game_comment_reactions
    where comment_id = p_comment_id and user_id = viewer_id;
    next_reaction := 0;
  else
    insert into public.game_comment_reactions (comment_id, user_id, reaction)
    values (p_comment_id, viewer_id, p_reaction)
    on conflict (comment_id, user_id) do update
      set reaction = excluded.reaction, updated_at = now();
    next_reaction := p_reaction;
  end if;

  return query
  select
    next_reaction,
    count(*) filter (where r.reaction = 1)::bigint,
    count(*) filter (where r.reaction = -1)::bigint,
    coalesce(sum(r.reaction), 0)::bigint
  from public.game_comment_reactions r
  where r.comment_id = p_comment_id;
end;
$$;

revoke all on function public.set_game_comment_reaction(bigint, smallint) from public;
grant execute on function public.set_game_comment_reaction(bigint, smallint) to authenticated;

create or replace function public.comment_author_name(p_user_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (
      select coalesce(
        nullif(i.identity_data ->> 'preferred_username', ''),
        nullif(i.identity_data ->> 'user_name', ''),
        nullif(i.identity_data ->> 'full_name', ''),
        nullif(i.identity_data ->> 'name', '')
      )
      from auth.identities i
      where i.user_id = p_user_id
        and lower(i.provider) = 'twitch'
      order by i.updated_at desc nulls last, i.created_at desc
      limit 1
    ),
    (
      select coalesce(
        nullif(u.raw_user_meta_data ->> 'preferred_username', ''),
        nullif(u.raw_user_meta_data ->> 'full_name', ''),
        nullif(u.raw_user_meta_data ->> 'name', ''),
        split_part(coalesce(u.email, 'Пользователь'), '@', 1)
      )
      from auth.users u
      where u.id = p_user_id
    ),
    'Пользователь'
  );
$$;

create or replace function public.comment_author_twitch_avatar(p_user_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (
      select coalesce(
        nullif(i.identity_data ->> 'avatar_url', ''),
        nullif(i.identity_data ->> 'picture', ''),
        nullif(i.identity_data ->> 'profile_image_url', '')
      )
      from auth.identities i
      where i.user_id = p_user_id
        and lower(i.provider) = 'twitch'
      order by i.updated_at desc nulls last, i.created_at desc
      limit 1
    ),
    (
      select coalesce(
        nullif(u.raw_user_meta_data ->> 'avatar_url', ''),
        nullif(u.raw_user_meta_data ->> 'picture', '')
      )
      from auth.users u
      where u.id = p_user_id
        and (
          lower(coalesce(u.raw_app_meta_data ->> 'provider', '')) = 'twitch'
          or coalesce(u.raw_app_meta_data -> 'providers', '[]'::jsonb) ? 'twitch'
        )
    )
  );
$$;

revoke all on function public.comment_author_name(uuid) from public, anon, authenticated;
revoke all on function public.comment_author_twitch_avatar(uuid) from public, anon, authenticated;

drop function if exists public.get_game_interactions(bigint);
create function public.get_game_interactions(p_game_id bigint)
returns table (
  like_count bigint,
  dislike_count bigint,
  score bigint,
  my_reaction smallint,
  comment_id bigint,
  username text,
  comment_avatar_url text,
  comment_body text,
  comment_created_at timestamptz,
  comment_updated_at timestamptz,
  comment_is_mine boolean,
  comment_can_delete boolean,
  comment_like_count bigint,
  comment_dislike_count bigint,
  comment_score bigint,
  comment_my_reaction smallint
)
language sql
stable
security definer
set search_path = ''
as $$
  with game_stats as (
    select
      count(*) filter (where vote = 1)::bigint as likes,
      count(*) filter (where vote = -1)::bigint as dislikes,
      coalesce(sum(vote), 0)::bigint as score
    from public.game_votes
    where game_id = p_game_id
  ), my_game_reaction as (
    select coalesce((
      select vote
      from public.game_votes
      where game_id = p_game_id and user_id = auth.uid()
    ), 0)::smallint as reaction
  ), viewer as (
    select coalesce(public.is_site_admin(), false) as is_admin
  ), comment_stats as (
    select
      r.comment_id,
      count(*) filter (where r.reaction = 1)::bigint as likes,
      count(*) filter (where r.reaction = -1)::bigint as dislikes,
      coalesce(sum(r.reaction), 0)::bigint as score
    from public.game_comment_reactions r
    group by r.comment_id
  )
  select
    game_stats.likes,
    game_stats.dislikes,
    game_stats.score,
    my_game_reaction.reaction,
    c.id,
    public.comment_author_name(c.user_id),
    public.comment_author_twitch_avatar(c.user_id),
    c.body,
    c.created_at,
    c.updated_at,
    coalesce(c.user_id = auth.uid(), false),
    coalesce(c.user_id = auth.uid(), false) or viewer.is_admin,
    coalesce(comment_stats.likes, 0),
    coalesce(comment_stats.dislikes, 0),
    coalesce(comment_stats.score, 0),
    coalesce((
      select r.reaction
      from public.game_comment_reactions r
      where r.comment_id = c.id and r.user_id = auth.uid()
    ), 0)::smallint
  from game_stats
  cross join my_game_reaction
  cross join viewer
  left join public.game_comments c on c.game_id = p_game_id
  left join comment_stats on comment_stats.comment_id = c.id
  where exists (
    select 1 from public.games where id = p_game_id and published = true
  )
  order by c.created_at desc nulls last;
$$;

drop function if exists public.get_public_suggestion_comments(bigint);
create function public.get_public_suggestion_comments(p_suggestion_id bigint)
returns table (
  id bigint,
  username text,
  avatar_url text,
  body text,
  created_at timestamptz,
  updated_at timestamptz,
  is_mine boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    c.id,
    public.comment_author_name(c.user_id),
    public.comment_author_twitch_avatar(c.user_id),
    c.body,
    c.created_at,
    c.updated_at,
    c.user_id = auth.uid()
  from public.suggestion_comments c
  join public.game_suggestions g on g.id = c.suggestion_id
  where c.suggestion_id = p_suggestion_id
    and not c.is_hidden
    and g.status in ('approved', 'selected')
  order by c.created_at asc;
$$;

drop function if exists public.get_admin_suggestion_support_comments_v2(bigint);
create function public.get_admin_suggestion_support_comments_v2(p_suggestion_id bigint)
returns table(
  comment_id bigint,
  username text,
  avatar_url text,
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
    c.id,
    public.comment_author_name(c.user_id),
    public.comment_author_twitch_avatar(c.user_id),
    c.body,
    c.is_hidden,
    c.created_at,
    c.updated_at
  from public.suggestion_supporters s
  join public.suggestion_comments c
    on c.suggestion_id = s.suggestion_id and c.user_id = s.user_id
  where s.suggestion_id = p_suggestion_id and btrim(c.body) <> ''
  order by c.created_at asc, c.id asc;
end;
$$;

revoke all on function public.get_game_interactions(bigint) from public;
revoke all on function public.get_public_suggestion_comments(bigint) from public;
revoke all on function public.get_admin_suggestion_support_comments_v2(bigint) from public, anon;
grant execute on function public.get_game_interactions(bigint) to anon, authenticated;
grant execute on function public.get_public_suggestion_comments(bigint) to anon, authenticated;
grant execute on function public.get_admin_suggestion_support_comments_v2(bigint) to authenticated;

-- Requested one-time reset: comments and all like/dislike records only.
delete from public.game_comment_reactions;
delete from public.game_comments;
delete from public.game_votes;
delete from public.suggestion_votes;
delete from public.suggestion_comments;

commit;

notify pgrst, 'reload schema';
