-- Independent tier lists for every streamer and content category.
-- Safe to run after supabase/tier_list_and_dropped.sql.

create table if not exists public.tier_list_boards (
  owner_key text not null,
  list_key text not null,
  config jsonb not null default '[]'::jsonb,
  placements jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (owner_key, list_key),
  constraint tier_list_boards_owner_check
    check (owner_key in ('sasaavot', 'tankzor', 'rostikfacekid')),
  constraint tier_list_boards_list_check
    check (list_key in ('games', 'food', 'cars')),
  constraint tier_list_boards_config_array_check
    check (jsonb_typeof(config) = 'array'),
  constraint tier_list_boards_placements_array_check
    check (jsonb_typeof(placements) = 'array')
);

alter table public.tier_list_boards enable row level security;

drop policy if exists "tier boards public read" on public.tier_list_boards;
create policy "tier boards public read"
  on public.tier_list_boards
  for select
  using (true);

drop policy if exists "tier boards admin insert" on public.tier_list_boards;
create policy "tier boards admin insert"
  on public.tier_list_boards
  for insert
  with check (public.is_site_admin());

drop policy if exists "tier boards admin update" on public.tier_list_boards;
create policy "tier boards admin update"
  on public.tier_list_boards
  for update
  using (public.is_site_admin())
  with check (public.is_site_admin());

with
default_config as (
  select jsonb_build_array(
    jsonb_build_object('id', 'S', 'label', 'S', 'color', '#e63d3d'),
    jsonb_build_object('id', 'A', 'label', 'A', 'color', '#e6913d'),
    jsonb_build_object('id', 'B', 'label', 'B', 'color', '#e6d23d'),
    jsonb_build_object('id', 'C', 'label', 'C', 'color', '#a5e63d'),
    jsonb_build_object('id', 'D', 'label', 'D', 'color', '#4be63d')
  ) as value
),
legacy_config as (
  select case
    when jsonb_typeof(config) = 'array' and jsonb_array_length(config) = 5 then config
    else (select value from default_config)
  end as value
  from public.tier_list_settings
  where id = 1
),
legacy_placements as (
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', id::text,
        'tier', tier_rank,
        'order', tier_order
      )
      order by tier_rank, tier_order, title
    ),
    '[]'::jsonb
  ) as value
  from public.games
  where published = true
    and library_status in ('completed', 'dropped')
),
boards(owner_key, list_key) as (
  values
    ('sasaavot', 'games'),
    ('sasaavot', 'food'),
    ('sasaavot', 'cars'),
    ('tankzor', 'games'),
    ('tankzor', 'food'),
    ('tankzor', 'cars'),
    ('rostikfacekid', 'games'),
    ('rostikfacekid', 'food'),
    ('rostikfacekid', 'cars')
)
insert into public.tier_list_boards (owner_key, list_key, config, placements)
select
  boards.owner_key,
  boards.list_key,
  case
    when boards.owner_key = 'sasaavot' and boards.list_key = 'games'
      then coalesce((select value from legacy_config), (select value from default_config))
    else (select value from default_config)
  end,
  case
    when boards.owner_key = 'sasaavot' and boards.list_key = 'games'
      then (select value from legacy_placements)
    else '[]'::jsonb
  end
from boards
on conflict (owner_key, list_key) do nothing;

create index if not exists tier_list_boards_updated_idx
  on public.tier_list_boards (updated_at desc);

notify pgrst, 'reload schema';
