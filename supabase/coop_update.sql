-- ПРЕДЛОЖКА CR7 — обновление для автоматического определения кооператива.
-- Запусти один раз в Supabase → SQL Editor.
-- Существующие игры, пользователи, RLS, даты и настройки не удаляются.

alter table public.games
  add column if not exists is_coop boolean not null default false,
  add column if not exists coop_type text not null default '',
  add column if not exists coop_min_players smallint,
  add column if not exists coop_max_players smallint,
  add column if not exists coop_source text not null default '';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'games_coop_type_allowed'
      and conrelid = 'public.games'::regclass
  ) then
    alter table public.games
      add constraint games_coop_type_allowed
      check (coop_type in ('', 'generic', 'online', 'local', 'mixed'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'games_coop_players_range'
      and conrelid = 'public.games'::regclass
  ) then
    alter table public.games
      add constraint games_coop_players_range
      check (
        (coop_min_players is null or coop_min_players between 2 and 64)
        and (coop_max_players is null or coop_max_players between 2 and 64)
        and (coop_min_players is null or coop_max_players is null or coop_min_players <= coop_max_players)
      );
  end if;
end $$;

comment on column public.games.is_coop is 'Автоматически определённый кооперативный режим Steam';
comment on column public.games.coop_type is 'generic, online, local или mixed';
comment on column public.games.coop_min_players is 'Минимальное число игроков в кооперативе, если удалось определить';
comment on column public.games.coop_max_players is 'Максимальное число игроков в кооперативе, если удалось определить';
comment on column public.games.coop_source is 'Источник автоматического определения кооператива и числа игроков';
