-- The organisations that invited $email (lower case) by an invitation not expired by $now, among
-- the ready ones, newest invitation first. The order names the projected `created_at`.
SELECT
  tenant.key AS key,
  created_at
FROM invitation
WHERE
  email = $email
  AND expires_at > $now
  AND tenant.status = 'ready'
ORDER BY created_at DESC;
