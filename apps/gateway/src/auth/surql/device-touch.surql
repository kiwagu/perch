-- Device $device of identity $identity (its key) signed in with refresh grant $grant: its row,
-- found by identity and device or created with key $id, takes the grant and the label $label,
-- is seen now, and is no longer revoked. The answer holds the row and the grant it held
-- before (`previous`, NONE for a new row), read in the same statement: the caller revokes it,
-- so a device never keeps two live grants.
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
RETURN VALUE { previous: $before.grant, row: $after };
