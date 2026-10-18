-- Device $device of identity $identity (its key) holds refresh grant $grant: its row, found by
-- identity and device or created with key $id, takes the grant, the label $label (the one it
-- has when $label is NONE), the time it was seen, and is no longer revoked.
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
  label = $label ?? label ?? '',
  grant = $grant,
  last_seen_at = time::now(),
  revoked_at = NONE
RETURN AFTER;
