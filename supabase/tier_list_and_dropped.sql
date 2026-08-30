-- Дропнутые игры и публичный тир-лист. Выполнить один раз в Supabase SQL Editor.
alter table public.games add column if not exists tier_rank text not null default '';
alter table public.games add column if not exists tier_order integer not null default 0;
alter table public.games drop constraint if exists games_library_status_check;
alter table public.games add constraint games_library_status_check
  check (library_status in ('', 'completed', 'dropped', 'ignored'));
alter table public.games drop constraint if exists games_tier_rank_check;
alter table public.games add constraint games_tier_rank_check
  check (tier_rank in ('', 'S', 'A', 'B', 'C', 'D'));
create index if not exists games_tier_rank_idx on public.games (tier_rank)
  where published = true and library_status in ('completed', 'dropped');
notify pgrst, 'reload schema';

create table if not exists public.tier_list_settings (
  id smallint primary key default 1 check (id = 1),
  config jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);
alter table public.tier_list_settings enable row level security;
drop policy if exists "tier settings public read" on public.tier_list_settings;
create policy "tier settings public read" on public.tier_list_settings for select using (true);
drop policy if exists "tier settings admin insert" on public.tier_list_settings;
create policy "tier settings admin insert" on public.tier_list_settings for insert with check (public.is_site_admin());
drop policy if exists "tier settings admin update" on public.tier_list_settings;
create policy "tier settings admin update" on public.tier_list_settings for update using (public.is_site_admin()) with check (public.is_site_admin());
insert into public.tier_list_settings (id,config) values (1,'[]'::jsonb) on conflict (id) do nothing;
