-- The device of identity $identity (its key) that holds grant $grant signed out: its row is
-- revoked now. Answers the row it marked, none when no device of the identity holds the grant or
-- it is revoked already.
UPDATE device_session SET
  revoked_at = time::now()
WHERE
  identity = type::record('identity', $identity)
  AND grant = $grant
  AND revoked_at = NONE
RETURN AFTER;
