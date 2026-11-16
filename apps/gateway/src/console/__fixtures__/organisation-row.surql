-- Organisation $tenant (its id's key) with key $key, name $name and status $status, made by
-- identity $identity (its key), and that identity's membership in it with role $role.
CREATE type::record('tenant', $tenant) SET
  key = $key,
  name = $name,
  status = $status,
  database = 't_' + $key,
  created_by = type::record('identity', $identity)
RETURN NONE;
CREATE membership SET
  identity = type::record('identity', $identity),
  tenant = type::record('tenant', $tenant),
  role = $role
RETURN NONE;
