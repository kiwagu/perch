-- Device $device of identity $identity (its key) renewed its pair: its row moves from grant
-- $spent to grant $next and is seen now, only while it holds $spent and is not revoked. Answers
-- the row it moved, none otherwise.
UPDATE device_session SET
  grant = $next,
  last_seen_at = time::now()
WHERE
  identity = type::record('identity', $identity)
  AND device = $device
  AND grant = $spent
  AND revoked_at = NONE
RETURN AFTER;
