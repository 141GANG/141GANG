-- Управление собственными комментариями к играм.
-- Авторизованный пользователь может изменять и удалять только свои комментарии.

alter table public.game_comments
  add column if not exists updated_at timestamptz;

update public.game_comments
set updated_at = created_at
where updated_at is null;

alter table public.game_comments
  alter column updated_at set default now();

alter table public.game_comments
  alter column updated_at set not null;

-- На одну опубликованную игру пользователь может оставить только один комментарий.
-- Если файл применяется к базе со старыми дублями, сохраняем самый свежий.
with ranked_comments as (
  select
    id,
    row_number() over (
      partition by game_id, user_id
      order by coalesce(updated_at, created_at) desc, created_at desc, id desc
    ) as row_num
  from public.game_comments
)
delete from public.game_comments c
using ranked_comments r
where c.id = r.id
  and r.row_num > 1;

create unique index if not exists game_comments_one_per_user_game_idx
  on public.game_comments (game_id, user_id);

create or replace function public.add_game_comment(p_game_id bigint, p_body text)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  viewer_id uuid := auth.uid();
  clean_body text := btrim(coalesce(p_body, ''));
  new_id bigint;
begin
  if viewer_id is null then
    raise exception 'Требуется авторизация.' using errcode = '42501';
  end if;

  if char_length(clean_body) not between 1 and 500 then
    raise exception 'Комментарий должен содержать от 1 до 500 символов.' using errcode = '22023';
  end if;

  if not exists (
    select 1
    from public.games
    where id = p_game_id
      and published = true
  ) then
    raise exception 'Игра не найдена.' using errcode = 'P0002';
  end if;

  if exists (
    select 1
    from public.game_comments
    where game_id = p_game_id
      and user_id = viewer_id
  ) then
    raise exception 'Вы уже оставили комментарий к этой игре. Используйте «Изменить».' using errcode = '23505';
  end if;

  begin
    insert into public.game_comments (game_id, user_id, body)
    values (p_game_id, viewer_id, clean_body)
    returning id into new_id;
  exception
    when unique_violation then
      raise exception 'Вы уже оставили комментарий к этой игре. Используйте «Изменить».' using errcode = '23505';
  end;

  return new_id;
end;
$$;

create or replace function public.update_game_comment(p_comment_id bigint, p_body text)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  viewer_id uuid := auth.uid();
  clean_body text := btrim(coalesce(p_body, ''));
  edited_at timestamptz;
begin
  if viewer_id is null then
    raise exception 'Требуется авторизация.' using errcode = '42501';
  end if;

  if char_length(clean_body) not between 1 and 500 then
    raise exception 'Комментарий должен содержать от 1 до 500 символов.' using errcode = '22023';
  end if;

  update public.game_comments
  set
    body = clean_body,
    updated_at = now()
  where id = p_comment_id
    and user_id = viewer_id
  returning updated_at into edited_at;

  if edited_at is null then
    raise exception 'Можно изменять только свои комментарии.' using errcode = '42501';
  end if;

  return edited_at;
end;
$$;

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
    and user_id = viewer_id;

  if not found then
    raise exception 'Можно удалять только свои комментарии.' using errcode = '42501';
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
  comment_is_mine boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  with stats as (
    select
      count(*) filter (where vote = 1)::bigint as likes,
      count(*) filter (where vote = -1)::bigint as dislikes,
      coalesce(sum(vote), 0)::bigint as score
    from public.game_votes
    where game_id = p_game_id
  ), mine as (
    select coalesce((
      select vote
      from public.game_votes
      where game_id = p_game_id
        and user_id = auth.uid()
    ), 0)::smallint as reaction
  )
  select
    stats.likes,
    stats.dislikes,
    stats.score,
    mine.reaction,
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
    coalesce(c.user_id = auth.uid(), false)
  from stats
  cross join mine
  left join public.game_comments c on c.game_id = p_game_id
  left join auth.users u on u.id = c.user_id
  where exists (
    select 1
    from public.games
    where id = p_game_id
      and published = true
  )
  order by c.created_at asc nulls last;
$$;

revoke all on function public.add_game_comment(bigint, text) from public;
grant execute on function public.add_game_comment(bigint, text) to authenticated;

revoke all on function public.update_game_comment(bigint, text) from public;
revoke all on function public.delete_game_comment(bigint) from public;
revoke all on function public.get_game_interactions(bigint) from public;
revoke execute on function public.update_game_comment(bigint, text) from anon;
revoke execute on function public.delete_game_comment(bigint) from anon;

grant execute on function public.update_game_comment(bigint, text) to authenticated;
grant execute on function public.delete_game_comment(bigint) to authenticated;
grant execute on function public.get_game_interactions(bigint) to anon, authenticated;

notify pgrst, 'reload schema';
