-- Ends at $ended_at every session of identity $identity (its key) that was not ended already, live
-- or expired: a live one keeps `revoked` as its reason for its device's next hello (every device
-- was signed out at once), and an expired one is marked ended at its expiry, with no reason. The
-- reason is set first, from the row as it was.
UPDATE device_session SET
  ended_reason = IF expires_at > $ended_at {
    'revoked';
  } ELSE {
    ended_reason;
  },
  ended_at = ended_at ?? time::min([expires_at, $ended_at]),
  expires_at = time::min([expires_at, $ended_at])
WHERE
  identity = $identity
  AND ended_at = NONE
RETURN NONE;
