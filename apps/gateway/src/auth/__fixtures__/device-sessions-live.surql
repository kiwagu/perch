-- The device of every session of identity $identity (its key) that has not ended.
SELECT VALUE device
FROM device_session
WHERE
  identity = $identity
  AND ended_at = NONE;
