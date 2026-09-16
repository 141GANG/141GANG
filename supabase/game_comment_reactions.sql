-- Реакции, сортировка и административная модерация комментариев к играм.
-- Выполните после game_interactions.sql и game_comment_management.sql.

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
  score bigint,
  like_count bigint,
  dislike_count bigint
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
    raise exception 'Реакция должна быть лайком или дизлайком.' using errcode = '22023';
  end if;

  if not exists (
    select 1
    from public.game_comments c
    join public.games g on g.id = c.game_id
    where c.id = p_comment_id
      and g.published = true
  ) then
    raise exception 'Комментарий не найден.' using errcode = 'P0002';
  end if;

  select r.reaction
  into previous_reaction
  from public.game_comment_reactions r
  where r.comment_id = p_comment_id
    and r.user_id = viewer_id;

  if previous_reaction = p_reaction then
    delete from public.game_comment_reactions
    where comment_id = p_comment_id
      and user_id = viewer_id;
    next_reaction := 0;
  else
    insert into public.game_comment_reactions (comment_id, user_id, reaction)
    values (p_comment_id, viewer_id, p_reaction)
    on conflict (comment_id, user_id) do update
      set reaction = excluded.reaction,
          updated_at = now();
    next_reaction := p_reaction;
  end if;

  return query
  select
    next_reaction,
    coalesce(sum(r.reaction), 0)::bigint,
    count(*) filter (where r.reaction = 1)::bigint,
    count(*) filter (where r.reaction = -1)::bigint
  from public.game_comment_reactions r
  where r.comment_id = p_comment_id;
end;
$$;

-- Автор может удалить собственный комментарий, администратор — любой.
create or replace function public.delete_game_comment(p_comment_id bigint)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  viewer_id uuid := auth.uid();
begin
  if viewer_id is null then
    raise exception 'Требуется авторизация.' using errcode = '42501';
  end if;

  delete from public.game_comments
  where id = p_comment_id
    and (
      user_id = viewer_id
      or public.is_site_admin()
    );

  if not found then
    raise exception 'Недостаточно прав для удаления комментария.' using errcode = '42501';
  end if;

  return true;
end;
$$;

drop function if exists public.get_game_interactions(bigint);

create function public.get_game_interactions(p_game_id bigint)
returns table (
  like_count bigint,
  dislike_count bigint,
  score bigint,
  my_reaction smallint,
  comment_id bigint,
  username text,
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
      where game_id = p_game_id
        and user_id = auth.uid()
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
    coalesce(
      nullif(u.raw_user_meta_data ->> 'preferred_username', ''),
      nullif(u.raw_user_meta_data ->> 'full_name', ''),
      nullif(u.raw_user_meta_data ->> 'name', ''),
      split_part(coalesce(u.email, 'Пользователь'), '@', 1)
    ),
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
      where r.comment_id = c.id
        and r.user_id = auth.uid()
    ), 0)::smallint
  from game_stats
  cross join my_game_reaction
  cross join viewer
  left join public.game_comments c on c.game_id = p_game_id
  left join auth.users u on u.id = c.user_id
  left join comment_stats on comment_stats.comment_id = c.id
  where exists (
    select 1
    from public.games
    where id = p_game_id
      and published = true
  )
  order by c.created_at desc nulls last;
$$;

revoke all on function public.set_game_comment_reaction(bigint, smallint) from public;
revoke all on function public.delete_game_comment(bigint) from public;
revoke all on function public.get_game_interactions(bigint) from public;

grant execute on function public.set_game_comment_reaction(bigint, smallint) to authenticated;
grant execute on function public.delete_game_comment(bigint) to authenticated;
grant execute on function public.get_game_interactions(bigint) to anon, authenticated;

notify pgrst, 'reload schema';
