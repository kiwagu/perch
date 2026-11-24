-- Every session row of the devices of identity $identity (its key), the earliest first, rows
-- created at the same instant by id; a sign-in's session still waiting for its admission is no
-- device's yet.
SELECT *
FROM device_session
WHERE
  identity = $identity
  AND pending = false
ORDER BY created_at, id;
