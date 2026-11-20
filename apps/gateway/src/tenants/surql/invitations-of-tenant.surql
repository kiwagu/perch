-- The invitations of organisation $tenant not expired by $now, newest first, each with the
-- organisation's id, key, name and status. The order names the projected `created_at`.
SELECT
  record::id(id) AS id,
  record::id(tenant) AS tenant,
  tenant.key AS key,
  tenant.name AS name,
  tenant.status AS status,
  email,
  role,
  token,
  expires_at,
  created_at
FROM invitation
WHERE
  tenant = $tenant
  AND expires_at > $now
ORDER BY created_at DESC;
