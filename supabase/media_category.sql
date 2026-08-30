-- 141 GANG — server-side category for media submissions.
-- Safe release migration: preserves existing rows and defaults them to personal.

alter table public.media_submissions
  add column if not exists category text not null default 'personal';

update public.media_submissions
set category = 'personal'
where category is null or category not in ('personal', 'creative', 'internet');

alter table public.media_submissions
  drop constraint if exists media_submissions_category_check,
  add constraint media_submissions_category_check
    check (category in ('personal', 'creative', 'internet'));

create index if not exists media_submissions_category_status_idx
  on public.media_submissions (category, status, created_at desc);

notify pgrst, 'reload schema';
