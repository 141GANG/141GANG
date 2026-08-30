-- Постоянные административные отметки игр для публичного каталога.
-- Выполни один раз в Supabase SQL Editor до публикации обновлённого frontend.

alter table public.games
  add column if not exists library_status text not null default '',
  add column if not exists is_favorite boolean not null default false,
  add column if not exists tier_rank text not null default '',
  add column if not exists tier_order integer not null default 0;

alter table public.games drop constraint if exists games_library_status_check;
alter table public.games
  add constraint games_library_status_check
  check (library_status in ('', 'completed', 'dropped', 'ignored'));

alter table public.games drop constraint if exists games_tier_rank_check;
alter table public.games add constraint games_tier_rank_check check (tier_rank in ('', 'S', 'A', 'B', 'C', 'D'));

create index if not exists games_library_status_idx
  on public.games (library_status, is_favorite)
  where published = true;

-- PostgREST обычно обновляет схему автоматически, но явное уведомление
-- сразу устраняет ошибку "column ... not found in the schema cache".
notify pgrst, 'reload schema';

-- Запись уже защищена существующими RLS-политиками games:
-- update разрешён только когда public.is_site_admin() возвращает true.
