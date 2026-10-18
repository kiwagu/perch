-- Device $device of identity $identity (its key) signed in with refresh grant $grant: its row,
-- found by identity and device or created with key $id, takes the grant and the label $label,
-- is seen now, and is no longer revoked.
UPSERT ONLY (
  SELECT VALUE id
  FROM ONLY device_session
  WHERE
    identity = type::record('identity', $identity)
    AND device = $device
  LIMIT 1
) ?? type::record('device_session', $id) SET
  identity = type::record('identity', $identity),
  device = $device,
  label = $label,
  grant = $grant,
  last_seen_at = time::now(),
  revoked_at = NONE
RETURN AFTER;
