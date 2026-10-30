-- The row of device $device of identity $identity (its key), or NONE.
SELECT *
FROM ONLY device_session
WHERE
  identity = type::record('identity', $identity)
  AND device = $device
LIMIT 1;
