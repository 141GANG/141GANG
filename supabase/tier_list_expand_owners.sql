-- Run this once when tier_list_boards was created by an earlier migration.
-- It expands the allowed streamer list and creates the missing boards.

alter table public.tier_list_boards
  drop constraint if exists tier_list_boards_owner_check;

alter table public.tier_list_boards
  add constraint tier_list_boards_owner_check
  check (owner_key in (
    'sasaavot',
    'rostikfacekid',
    'helin139',
    'formixyouknow',
    'tankzor',
    'r4dom1r',
    'poisonika'
  ));

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
boards(owner_key, list_key) as (
  values
    ('helin139', 'games'), ('helin139', 'food'), ('helin139', 'cars'),
    ('formixyouknow', 'games'), ('formixyouknow', 'food'), ('formixyouknow', 'cars'),
    ('r4dom1r', 'games'), ('r4dom1r', 'food'), ('r4dom1r', 'cars'),
    ('poisonika', 'games'), ('poisonika', 'food'), ('poisonika', 'cars')
)
insert into public.tier_list_boards (owner_key, list_key, config, placements)
select boards.owner_key, boards.list_key, default_config.value, '[]'::jsonb
from boards
cross join default_config
on conflict (owner_key, list_key) do nothing;

notify pgrst, 'reload schema';
