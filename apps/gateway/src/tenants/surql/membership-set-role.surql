-- Identity $identity holds role $role in organisation $tenant from now on; nothing changes for one
-- that is no member.
UPDATE membership SET
  role = $role
WHERE
  identity = $identity
  AND tenant = $tenant
RETURN NONE;
