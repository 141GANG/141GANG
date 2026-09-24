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