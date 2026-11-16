-- Invitation $id with its organisation's id, key, name and status, or NONE when it is gone or
-- expired by $now.
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
FROM ONLY type::record('invitation', $id)
WHERE expires_at > $now;
