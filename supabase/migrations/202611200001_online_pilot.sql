create table public.ipm_workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) > 0),
  created_at timestamptz not null default now()
);

create table public.ipm_memberships (
  workspace_id uuid not null references public.ipm_workspaces(id) on delete cascade,
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null check (role in ('admin', 'manager', 'analyst')),
  project_codes text[] not null default '{}'
);

create table public.ipm_workspace_state (
  workspace_id uuid primary key references public.ipm_workspaces(id) on delete cascade,
  version bigint not null default 0 check (version >= 0),
  payload jsonb not null default '{}'::jsonb check (jsonb_typeof(payload) = 'object'),
  updated_at timestamptz not null default now()
);

alter table public.ipm_workspaces enable row level security;
alter table public.ipm_memberships enable row level security;
alter table public.ipm_workspace_state enable row level security;
revoke all on public.ipm_workspaces, public.ipm_memberships, public.ipm_workspace_state from anon, authenticated;
grant select on public.ipm_workspaces, public.ipm_memberships to service_role;
grant select, update on public.ipm_workspace_state to service_role;
