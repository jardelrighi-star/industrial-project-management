alter table public.ipm_memberships
  drop constraint if exists ipm_memberships_role_check,
  add constraint ipm_memberships_role_check
    check (role in ('admin', 'manager', 'analyst', 'buyer', 'legal'));
