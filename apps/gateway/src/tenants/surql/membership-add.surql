-- Identity $identity joins organisation $tenant with role $role; the unique index refuses a
-- second membership of the same pair.
CREATE type::record('membership', $id) SET
  identity = $identity,
  tenant = $tenant,
  role = $role;
