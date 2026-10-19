-- The device of identity $identity (its key) that holds grant $grant signed out: its row is
-- revoked now, or stays revoked since it was. Answers the row, none when no device of the
-- identity holds the grant: asking again answers the same row.
UPDATE device_session SET
  revoked_at = revoked_at ?? time::now()
WHERE
  identity = type::record('identity', $identity)
  AND grant = $grant
RETURN AFTER;
