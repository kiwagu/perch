-- Device $device of identity $identity (its key) was seen at $seen_at: its live session is marked
-- seen then and lives until $expires_at, a full lifetime again. A session that ended stays as it
-- is, however late this lands: the instants were taken before it was sent, and an ending that
-- committed since leaves `expires_at` after them, so `ended_at` decides.
UPDATE device_session SET
  last_seen_at = $seen_at,
  expires_at = $expires_at
WHERE
  identity = $identity
  AND device = $device
  AND ended_at = NONE
  AND expires_at > $seen_at
RETURN NONE;
