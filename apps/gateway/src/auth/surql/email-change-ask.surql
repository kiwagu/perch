-- Keeps the pending change of the email of identity $identity (its key) as the one whose link
-- carries $jti until $expires_at, replacing the change asked before it, if any: only the newest
-- link of an identity changes its email. The row is `verification` $id under the identifier
-- `change-email:<identity key>`.
BEGIN TRANSACTION;
  DELETE verification
  WHERE identifier = string::concat('change-email:', $identity)
  RETURN NONE;
  CREATE type::record('verification', $id) SET
    identifier = string::concat('change-email:', $identity),
    `value` = $jti,
    expires_at = $expires_at
  RETURN NONE;
COMMIT TRANSACTION;
