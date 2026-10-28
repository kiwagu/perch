-- The devices of identity $identity (its key), the earliest first: those not revoked, and those
-- revoked after $since.
SELECT *
FROM device_session
WHERE
  identity = type::record('identity', $identity)
  AND (
    revoked_at = NONE
    OR revoked_at > $since
  )
ORDER BY created_at;
