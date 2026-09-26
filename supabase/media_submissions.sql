-- ПРЕДЛОЖКА CR7 — фото и видео для будущих стримов.
-- Сначала выполни supabase/supabase_setup.sql, затем целиком этот файл.
-- Загружать и модерировать материалы могут только site_admins.
-- Опубликованные материалы доступны посетителям только через Edge Function
-- public-media, которая не раскрывает UUID пользователей и storage_path.

create table if not exists public.media_submissions (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  comment text not null default '',
  media_type text not null default 'video',
  status text not null default 'pending',
  created_by uuid not null default auth.uid() references auth.users(id) on delete cascade,
  moderated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  moderated_at timestamptz,
  published_at timestamptz,
  archived_at timestamptz
);

create table if not exists public.media_submission_files (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references public.media_submissions(id) on delete cascade,
  storage_path text not null unique check (char_length(storage_path) between 1 and 500),
  file_name text not null check (char_length(file_name) between 1 and 255),
  mime_type text not null check (
    mime_type in (
      'image/jpeg',
      'image/png',
      'image/webp',
      'image/gif',
      'video/mp4',
      'video/webm',
      'video/quicktime',
      'application/octet-stream'
    )
  ),
  file_size bigint not null check (file_size between 1 and 104857600),
  sort_order smallint not null default 0 check (sort_order between 0 and 7),
  created_by uuid not null default auth.uid() references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table public.media_submissions
  add column if not exists media_type text,
  add column if not exists published_at timestamptz,
  add column if not exists archived_at timestamptz;

-- Переводим старые статусы без потери уже загруженных материалов.
alter table public.media_submissions
  drop constraint if exists media_submissions_status_check,
  drop constraint if exists media_submissions_title_check,
  drop constraint if exists media_submissions_comment_check,
  drop constraint if exists media_submissions_media_type_check;

update public.media_submissions
set status = case
  when status = 'approved' then 'published'
  when status = 'rejected' then 'archived'
  else status
end
where status in ('approved', 'rejected');

update public.media_submissions submission
set media_type = case
  when exists (
    select 1
    from public.media_submission_files file
    where file.submission_id = submission.id
      and (
        file.mime_type like 'video/%'
        or file.file_name ~* '\.(mp4|webm|mov)$'
      )
  ) and exists (
    select 1
    from public.media_submission_files file
    where file.submission_id = submission.id
      and not (
        file.mime_type like 'video/%'
        or file.file_name ~* '\.(mp4|webm|mov)$'
      )
  ) then 'mixed'
  when exists (
    select 1
    from public.media_submission_files file
    where file.submission_id = submission.id
      and (
        file.mime_type like 'video/%'
        or file.file_name ~* '\.(mp4|webm|mov)$'
      )
  ) then 'video'
  else 'photo'
end
where media_type is null
   or media_type not in ('video', 'photo', 'mixed');

update public.media_submissions
set title = coalesce(nullif(btrim(title), ''), 'Материал без названия');

alter table public.media_submissions
  alter column title set not null,
  alter column media_type set default 'video',
  alter column media_type set not null,
  alter column status set default 'pending',
  add constraint media_submissions_title_check
    check (char_length(btrim(title)) between 1 and 120),
  add constraint media_submissions_comment_check
    check (char_length(comment) <= 1000),
  add constraint media_submissions_media_type_check
    check (media_type in ('video', 'photo', 'mixed')),
  add constraint media_submissions_status_check
    check (status in ('pending', 'published', 'archived'));

create index if not exists media_submissions_status_created_idx
  on public.media_submissions (status, created_at desc);

create index if not exists media_submissions_type_status_idx
  on public.media_submissions (media_type, status, created_at desc);

create index if not exists media_submission_files_submission_idx
  on public.media_submission_files (submission_id, sort_order);

create unique index if not exists media_submission_files_submission_sort_unique
  on public.media_submission_files (submission_id, sort_order);

create or replace function public.set_media_submission_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function public.enforce_media_submission_quota()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
begin
  if auth.role() = 'service_role' then return new; end if;
  if v_user_id is null
    or new.created_by is distinct from v_user_id
    or coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) then
    raise exception 'Требуется обычный аккаунт зрителя.' using errcode = '42501';
  end if;
  if public.is_site_admin() then return new; end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_user_id::text, 141));
  if (
    select count(*)
    from public.media_submissions submission
    where submission.created_by = v_user_id
      and submission.status = 'pending'
  ) >= 3 then
    raise exception 'У тебя уже есть три материала на модерации.' using errcode = '23514';
  end if;
  if (
    select count(*)
    from public.media_submissions submission
    where submission.created_by = v_user_id
      and submission.created_at >= pg_catalog.now() - interval '24 hours'
  ) >= 10 then
    raise exception 'За 24 часа можно отправить не больше десяти материалов.' using errcode = '23514';
  end if;
  return new;
end;
$$;

revoke all on function public.enforce_media_submission_quota() from public, anon, authenticated;

drop trigger if exists media_submissions_set_updated_at on public.media_submissions;
create trigger media_submissions_set_updated_at
before update on public.media_submissions
for each row execute function public.set_media_submission_updated_at();

drop trigger if exists media_submissions_enforce_quota on public.media_submissions;
create trigger media_submissions_enforce_quota
before insert on public.media_submissions
for each row execute function public.enforce_media_submission_quota();

alter table public.media_submissions enable row level security;
alter table public.media_submission_files enable row level security;

revoke all on table public.media_submissions from anon, authenticated;
revoke all on table public.media_submission_files from anon, authenticated;
grant select, insert, update, delete on table public.media_submissions to authenticated;
grant select, insert, delete on table public.media_submission_files to authenticated;

drop policy if exists "Media submissions public read" on public.media_submissions;
drop policy if exists "Media submissions admin read" on public.media_submissions;
drop policy if exists "Media submissions admin insert" on public.media_submissions;
drop policy if exists "Media submissions admin update" on public.media_submissions;
drop policy if exists "Media submissions admin delete" on public.media_submissions;

create policy "Media submissions admin read"
on public.media_submissions
for select
to authenticated
using ((select public.is_site_admin()));

create policy "Media submissions admin insert"
on public.media_submissions
for insert
to authenticated
with check (
  (select public.is_site_admin())
  and created_by = (select auth.uid())
  and status = 'pending'
  and moderated_by is null
  and moderated_at is null
  and published_at is null
  and archived_at is null
);

create policy "Media submissions admin update"
on public.media_submissions
for update
to authenticated
using ((select public.is_site_admin()))
with check ((select public.is_site_admin()));

create policy "Media submissions admin delete"
on public.media_submissions
for delete
to authenticated
using ((select public.is_site_admin()));

drop policy if exists "Media files public read" on public.media_submission_files;
drop policy if exists "Media files admin read" on public.media_submission_files;
drop policy if exists "Media files admin insert" on public.media_submission_files;
drop policy if exists "Media files admin delete" on public.media_submission_files;

create policy "Media files admin read"
on public.media_submission_files
for select
to authenticated
using ((select public.is_site_admin()));

create policy "Media files admin insert"
on public.media_submission_files
for insert
to authenticated
with check (
  (select public.is_site_admin())
  and created_by = (select auth.uid())
  and exists (
    select 1
    from public.media_submissions submission
    where submission.id = submission_id
      and submission.created_by = (select auth.uid())
      and submission.status = 'pending'
  )
);

create policy "Media files admin delete"
on public.media_submission_files
for delete
to authenticated
using ((select public.is_site_admin()));

-- Закрытый bucket. Даже опубликованные файлы выдаются только временными ссылками.
insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'stream-submissions',
  'stream-submissions',
  false,
  104857600,
  array[
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/gif',
    'video/mp4',
    'video/webm',
    'video/quicktime',
    'application/octet-stream'
  ]
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Media bucket public read" on storage.objects;
drop policy if exists "Media bucket admin read" on storage.objects;
drop policy if exists "Media bucket admin upload" on storage.objects;
drop policy if exists "Media bucket admin delete" on storage.objects;

create policy "Media bucket admin read"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'stream-submissions'
  and (select public.is_site_admin())
);

create policy "Media bucket admin upload"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'stream-submissions'
  and (select public.is_site_admin())
  and name ~ '^objects/[A-Za-z0-9-]{16,100}\.(jpg|jpeg|png|webp|gif|mp4|webm|mov)$'
  and exists (
    select 1
    from public.media_submission_files file
    join public.media_submissions submission on submission.id = file.submission_id
    where file.storage_path = name
      and submission.created_by = (select auth.uid())
      and submission.status = 'pending'
  )
);

create policy "Media bucket admin delete"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'stream-submissions'
  and (select public.is_site_admin())
);

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'media_submissions'
  ) then
    alter publication supabase_realtime add table public.media_submissions;
  end if;
end
$$;
