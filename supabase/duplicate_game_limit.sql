-- Запрещает хранить больше двух экземпляров одной Steam-игры.
-- Выполни один раз в Supabase → SQL Editor.

create or replace function public.enforce_game_copy_limit()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  existing_count integer;
begin
  if new.steam_app_id is null then
    return new;
  end if;

  perform pg_advisory_xact_lock(new.steam_app_id::bigint);
  select count(*) into existing_count
  from public.games
  where steam_app_id = new.steam_app_id
    and id is distinct from new.id;

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
