-- Репутация игр. Один администратор может оставить один голос на игру.

create table if not exists public.game_votes (
  game_id bigint not null references public.games(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  vote smallint not null check (vote in (-1, 1)),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (game_id, user_id)
);

alter table public.game_votes enable row level security;
revoke all on table public.game_votes from anon, authenticated;

create or replace function public.get_game_vote_scores()
returns table (game_id bigint, score bigint)
language sql
stable
security definer
set search_path = ''
as $$
  select g.id, coalesce(sum(v.vote), 0)::bigint
  from public.games g
  left join public.game_votes v on v.game_id = g.id
  where g.published = true
  group by g.id;
$$;

create or replace function public.get_my_game_votes()
returns table (game_id bigint, vote smallint)
language sql
stable
security definer
set search_path = ''
as $$
  select v.game_id, v.vote
  from public.game_votes v
  where v.user_id = (select auth.uid())
    and public.is_site_admin();
$$;

create or replace function public.vote_game(p_game_id bigint, p_vote smallint)
returns table (score bigint, current_vote smallint)
language plpgsql
security definer
set search_path = ''
as $$
declare
  viewer_id uuid := auth.uid();
begin
  if viewer_id is null or not public.is_site_admin() then
    raise exception 'Only site administrators can vote' using errcode = '42501';
  end if;
  if p_vote is null or p_vote not in (-1, 0, 1) then
    raise exception 'Vote must be -1, 0 or 1' using errcode = '22023';
  end if;
  if not exists (select 1 from public.games where id = p_game_id) then
    raise exception 'Game not found' using errcode = 'P0002';
  end if;

  if p_vote = 0 then
    delete from public.game_votes where game_id = p_game_id and user_id = viewer_id;
  else
    insert into public.game_votes (game_id,user_id,vote)
    values (p_game_id,viewer_id,p_vote)
    on conflict (game_id,user_id) do update
      set vote = excluded.vote,updated_at = now();
  end if;

  return query
    select coalesce(sum(v.vote),0)::bigint,p_vote
    from public.game_votes v
    where v.game_id = p_game_id;
end;
$$;

revoke all on function public.get_game_vote_scores() from public;
revoke all on function public.get_my_game_votes() from public;
revoke all on function public.vote_game(bigint,smallint) from public;
grant execute on function public.get_game_vote_scores() to anon, authenticated;
grant execute on function public.get_my_game_votes() to authenticated;
grant execute on function public.vote_game(bigint,smallint) to authenticated;

notify pgrst, 'reload schema';
