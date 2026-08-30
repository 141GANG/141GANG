-- Автоматическая синхронизация игр Steam каждые 6 часов.
-- Перед запуском замени три значения ниже и выполни файл один раз в Supabase SQL Editor.

create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

select vault.create_secret('https://YOUR-PROJECT.supabase.co', 'steam_sync_project_url');
select vault.create_secret('YOUR-SUPABASE-ANON-KEY', 'steam_sync_anon_key');
select vault.create_secret('REPLACE-WITH-A-LONG-RANDOM-SECRET', 'steam_sync_cron_secret');

select cron.unschedule(jobid)
from cron.job
where jobname = 'steam-game-auto-sync';

select cron.schedule(
  'steam-game-auto-sync',
  '0 */6 * * *',
  $cron$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'steam_sync_project_url') || '/functions/v1/steam-game',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'steam_sync_anon_key'),
      'apikey', (select decrypted_secret from vault.decrypted_secrets where name = 'steam_sync_anon_key'),
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'steam_sync_cron_secret')
    ),
    body := '{"action":"sync-stale"}'::jsonb,
    timeout_milliseconds := 120000
  );
  $cron$
);

-- Проверка задания:
-- select jobid, jobname, schedule, active from cron.job where jobname = 'steam-game-auto-sync';
-- Последние запуски:
-- select * from cron.job_run_details where jobid = (select jobid from cron.job where jobname = 'steam-game-auto-sync') order by start_time desc limit 10;
