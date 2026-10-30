-- Device $device of identity $identity (its key) was seen now.
UPDATE device_session SET
  last_seen_at = time::now()
WHERE
  identity = type::record('identity', $identity)
  AND device = $device
RETURN NONE;
