-- The invitations of $email (lower case) not expired by $now, to the ready organisations identity
-- $identity does not belong to, newest first. The order names the projected `created_at`.
SELECT
  record::id(id) AS id,
  tenant.name AS name,
  role,
  created_at
FROM invitation
WHERE
  email = $email
  AND expires_at > $now
  AND tenant.status = 'ready'
  AND tenant NOTINSIDE (
    SELECT VALUE tenant
    FROM membership
    WHERE identity = $identity
  )
ORDER BY created_at DESC;
