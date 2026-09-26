-- Security release: private delivery for published media.
-- Run this file in Supabase SQL Editor, then deploy the public-media Edge Function.

begin;

update storage.buckets
set public = false
where id = 'stream-submissions';

-- sort_order is constrained to 0..7, so this unique index makes the eight-file
-- limit enforceable by Postgres rather than only by browser JavaScript.
create unique index if not exists media_submission_files_submission_sort_unique
  on public.media_submission_files (submission_id, sort_order);

-- Serialised per-user quota checks limit account-based storage abuse while
-- leaving administrators and server-side maintenance unaffected.
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
drop trigger if exists media_submissions_enforce_quota on public.media_submissions;
create trigger media_submissions_enforce_quota
before insert on public.media_submissions
for each row execute function public.enforce_media_submission_quota();

-- Anonymous visitors must not be able to enumerate either object names or the
-- relational metadata that contains user UUIDs and internal storage paths.
revoke select on table public.media_submissions from anon;
revoke select on table public.media_submission_files from anon;

drop policy if exists "Media submissions public read" on public.media_submissions;
drop policy if exists "Media files public read" on public.media_submission_files;
drop policy if exists "Media bucket public read" on storage.objects;

-- A signed-in non-admin may see only their own pending submission through the
-- ownership policies from allow_authenticated_content_submissions.sql.
drop policy if exists "Media submissions admin read" on public.media_submissions;
create policy "Media submissions admin read"
on public.media_submissions
for select
to authenticated
using ((select public.is_site_admin()));

drop policy if exists "Media files admin read" on public.media_submission_files;
create policy "Media files admin read"
on public.media_submission_files
for select
to authenticated
using ((select public.is_site_admin()));

drop policy if exists "Media bucket admin read" on storage.objects;
create policy "Media bucket admin read"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'stream-submissions'
  and (select public.is_site_admin())
);

-- An uploader may create only an object that was predeclared in the metadata
-- table for the same owned pending submission. This blocks arbitrary/unbounded
-- object creation under an authenticated user's pending submission.
drop policy if exists "Media bucket authenticated upload" on storage.objects;
create policy "Media bucket authenticated upload"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'stream-submissions'
  and auth.uid() is not null
  and not coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false)
  and name ~ '^objects/[A-Za-z0-9-]{16,100}\.(jpg|jpeg|png|webp|gif|mp4|webm|mov)$'
  and exists (
    select 1
    from public.media_submission_files file
    join public.media_submissions submission on submission.id = file.submission_id
    where file.storage_path = name
      and submission.created_by = auth.uid()
      and submission.status = 'pending'
  )
);

drop policy if exists "Media bucket own pending read" on storage.objects;
create policy "Media bucket own pending read"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'stream-submissions'
  and auth.uid() is not null
  and not coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false)
  and exists (
    select 1
    from public.media_submission_files file
    join public.media_submissions submission on submission.id = file.submission_id
    where file.storage_path = name
      and submission.created_by = auth.uid()
      and submission.status = 'pending'
  )
);

drop policy if exists "Media bucket own pending delete" on storage.objects;
create policy "Media bucket own pending delete"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'stream-submissions'
  and auth.uid() is not null
  and not coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false)
  and exists (
    select 1
    from public.media_submission_files file
    join public.media_submissions submission on submission.id = file.submission_id
    where file.storage_path = name
      and submission.created_by = auth.uid()
      and submission.status = 'pending'
  )
);

-- Prevent future SECURITY DEFINER functions from silently becoming callable by
-- every API role. Individual project migrations explicitly grant the intended
-- functions after creation.
alter default privileges in schema public revoke execute on functions from public;
alter default privileges in schema public revoke execute on functions from anon, authenticated;

commit;

notify pgrst, 'reload schema';
