-- ПРЕДЛОЖКА CR7 — обновление для дат релиза Steam
-- Запусти этот файл ОДИН РАЗ в Supabase → SQL Editor.
-- Существующие таблицы, пользователи, RLS и игры не удаляются.

alter table public.games
  add column if not exists steam_app_id bigint,
  add column if not exists release_date date,
  add column if not exists release_date_text text not null default '',
  add column if not exists coming_soon boolean not null default false,
  add column if not exists steam_synced_at timestamptz;

-- Необязательные ограничения, которые не затрагивают старые записи.
do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'games_release_date_text_length'
      and conrelid = 'public.games'::regclass
  ) then
    alter table public.games
      add constraint games_release_date_text_length
      check (char_length(release_date_text) <= 120);
  end if;
end $$;

create index if not exists games_release_date_idx
  on public.games (coming_soon desc, release_date asc, display_order asc, created_at desc);

comment on column public.games.steam_app_id is 'Числовой App ID игры в Steam';
comment on column public.games.release_date is 'Дата для автоматической сортировки. Для приблизительных сроков может быть началом месяца/квартала/года.';
comment on column public.games.release_date_text is 'Исходный текст даты, который показал Steam';
comment on column public.games.coming_soon is 'true, если Steam считает игру ещё не вышедшей';
comment on column public.games.steam_synced_at is 'Время последнего получения данных из Steam';

create or replace function public.enforce_game_copy_limit()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  existing_count integer;
begin
  if new.steam_app_id is null then return new; end if;
  perform pg_advisory_xact_lock(new.steam_app_id::bigint);
  select count(*) into existing_count from public.games
  where steam_app_id = new.steam_app_id and id is distinct from new.id;
  if existing_count >= 2 then
    raise exception 'Нельзя добавить больше двух экземпляров одной Steam-игры.'
      using errcode = '23514', constraint = 'games_steam_app_id_max_two';
  end if;
  return new;
end;
$$;

drop trigger if exists games_enforce_copy_limit on public.games;
create trigger games_enforce_copy_limit
before insert or update of steam_app_id on public.games
for each row execute function public.enforce_game_copy_limit();
