-- Keeps the pending deletion of the account of identity $identity (its key) as the one whose link
-- carries $jti until $expires_at, replacing the deletion asked before it, if any: only the newest
-- link of an identity deletes its account. The row is `verification` $id under the identifier
-- `delete-account:<identity key>`.
BEGIN TRANSACTION;
  DELETE verification
  WHERE identifier = string::concat('delete-account:', $identity)
  RETURN NONE;
  CREATE type::record('verification', $id) SET
    identifier = string::concat('delete-account:', $identity),
    `value` = $jti,
    expires_at = $expires_at
  RETURN NONE;
COMMIT TRANSACTION;
