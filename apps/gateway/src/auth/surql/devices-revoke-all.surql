-- Every device of identity $identity (its key) that is not revoked is revoked now.
UPDATE device_session SET
  revoked_at = time::now()
WHERE
  identity = type::record('identity', $identity)
  AND revoked_at = NONE
RETURN NONE;
