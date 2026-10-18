-- Device session $id is revoked, now or when it was already, if it belongs to identity
-- $identity (its key): its row, or NONE when the identity has no such device.
UPDATE ONLY type::record('device_session', $id) SET
  revoked_at = revoked_at ?? time::now()
WHERE identity = type::record('identity', $identity)
RETURN AFTER;
