-- 141GANG blocker-fix: preserve overall player range after publication.
-- Co-op limits remain separate in coop_min_players / coop_max_players.

alter table public.games
  add column if not exists players_min smallint not null default 1,
  add column if not exists players_max smallint not null default 1,
  add column if not exists player_count_source text not null default '';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'games_players_range'
      and conrelid = 'public.games'::regclass
  ) then
    alter table public.games
      add constraint games_players_range
      check (
        players_min between 1 and 256
        and players_max between 1 and 256
        and players_min <= players_max
      );
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'games_player_count_source_length'
      and conrelid = 'public.games'::regclass
  ) then
    alter table public.games
      add constraint games_player_count_source_length
      check (char_length(player_count_source) <= 120);
  end if;
end $$;

update public.games as game
set
  players_min = suggestion.players_min::smallint,
  players_max = suggestion.players_max::smallint,
  player_count_source = left(coalesce(nullif(suggestion.player_count_source, ''), 'suggestion_snapshot'), 120)
from public.game_suggestions as suggestion
where suggestion.steam_app_id = game.steam_app_id
  and suggestion.status in ('approved', 'selected')
  and suggestion.players_min between 1 and 256
  and suggestion.players_max between suggestion.players_min and 256;

comment on column public.games.players_min is 'Минимальное общее число игроков, включая одиночный режим';
comment on column public.games.players_max is 'Максимальное общее число игроков';
comment on column public.games.player_count_source is 'Источник общего диапазона игроков';

grant select (players_min, players_max, player_count_source)
on table public.games to anon, authenticated;

notify pgrst, 'reload schema';

-- Keep the published row synchronized with the accepted suggestion snapshot.
-- This prevents publication from collapsing an overall range such as 1–2
-- into a co-op-only value such as 2.
create or replace function public.sync_game_player_range_from_suggestion()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status in ('approved', 'selected') then
    update public.games
       set players_min = new.players_min::smallint,
           players_max = new.players_max::smallint,
           player_count_source = left(
             coalesce(nullif(new.player_count_source, ''), 'suggestion_snapshot'),
             120
           )
     where steam_app_id = new.steam_app_id;
  end if;
  return new;
end;
$$;

revoke all on function public.sync_game_player_range_from_suggestion() from public;

drop trigger if exists game_suggestions_sync_published_player_range on public.game_suggestions;
create trigger game_suggestions_sync_published_player_range
after insert or update of status, players_min, players_max, player_count_source
on public.game_suggestions
for each row
when (new.status in ('approved', 'selected'))
execute function public.sync_game_player_range_from_suggestion();

notify pgrst, 'reload schema';
