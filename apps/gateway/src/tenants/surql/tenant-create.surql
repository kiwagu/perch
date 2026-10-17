-- The directory rows of a new organisation and its creator's admin membership, in one
-- transaction: the unique key settles which creator owns the key.
BEGIN TRANSACTION;
  LET $tenant = (
    CREATE type::record('tenant', $id) SET
      key = $key,
      name = $name,
      database = $database,
      status = 'provisioning',
      created_by = $identity
  )[0];
  CREATE type::record('membership', $membership) SET
    identity = $identity,
    tenant = $tenant.id,
    role = 'admin';
  RETURN $tenant;
COMMIT TRANSACTION;
