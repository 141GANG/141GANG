-- 141GANG release hardening: media queue author names must not depend on
-- browser localStorage. Only authenticated site admins can read this mapping.

create or replace function public.get_media_submission_authors()
returns table (
  submission_id uuid,
  display_name text
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    submission.id as submission_id,
    coalesce(
      nullif(btrim(coalesce(user_row.raw_user_meta_data ->> 'preferred_username', '')), ''),
      nullif(btrim(coalesce(user_row.raw_user_meta_data ->> 'full_name', '')), ''),
      nullif(btrim(coalesce(user_row.raw_user_meta_data ->> 'name', '')), ''),
      nullif(btrim(split_part(coalesce(user_row.email, ''), '@', 1)), ''),
      'Не указан'
    ) as display_name
  from public.media_submissions as submission
  left join auth.users as user_row on user_row.id = submission.created_by
  where public.is_site_admin();
$$;

revoke execute on function public.get_media_submission_authors() from public, anon;
grant execute on function public.get_media_submission_authors() to authenticated;
