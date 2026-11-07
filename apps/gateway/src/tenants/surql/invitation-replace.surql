-- Keeps invitation $id of email $email (lower case) to organisation $tenant with role $role, by
-- $inviter, its link carrying $link_token, until $expires_at; the email's pending invitation to that
-- organisation goes first, and so does every one of the organisation expired by $now.
BEGIN TRANSACTION;
  DELETE invitation
  WHERE
    tenant = $tenant
    AND (
      email = $email
      OR expires_at <= $now
    )
  RETURN NONE;
  CREATE type::record('invitation', $id) SET
    tenant = $tenant,
    email = $email,
    role = $role,
    inviter = $inviter,
    token = $link_token,
    expires_at = $expires_at
  RETURN NONE;
COMMIT TRANSACTION;
