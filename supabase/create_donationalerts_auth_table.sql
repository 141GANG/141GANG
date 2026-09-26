create table if not exists public.donationalerts_auth (
  id integer primary key default 1,
  da_user_id bigint,
  da_user_code text,
  da_user_name text,

  access_token text not null,
  refresh_token text not null,
  token_type text,

  socket_connection_token text,

  expires_at timestamptz,
  updated_at timestamptz not null default now(),

  constraint donationalerts_auth_single_row check (id = 1)
);

alter table public.donationalerts_auth enable row level security;

revoke all
on table public.donationalerts_auth
from anon, authenticated;

-- The browser never receives DonationAlerts tokens. Authenticated site users can
-- only ask whether the shared integration is ready and see its public label.
create or replace function public.get_donationalerts_connection_status()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  connection public.donationalerts_auth%rowtype;
begin
  if auth.uid() is null or coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  select * into connection
  from public.donationalerts_auth
  where id = 1;

  return pg_catalog.jsonb_build_object(
    'connected', connection.access_token is not null,
    'name', coalesce(connection.da_user_name, ''),
    'code', coalesce(connection.da_user_code, '')
  );
end;
$$;

revoke all on function public.get_donationalerts_connection_status() from public, anon;
grant execute on function public.get_donationalerts_connection_status() to authenticated;
