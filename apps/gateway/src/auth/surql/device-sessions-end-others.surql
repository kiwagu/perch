-- Ends at $ended_at every session of identity $identity (its key) but session $keep (its key)
-- that was not ended already, live or expired: an expired one is marked ended at its expiry,
-- which stays. Answers, for each session it marked, its device and whether it was live until now.
UPDATE device_session SET
  ended_at = ended_at ?? time::min([expires_at, $ended_at]),
  expires_at = time::min([expires_at, $ended_at])
WHERE
  identity = $identity
  AND ended_at = NONE
  AND id != type::record('device_session', $keep)
RETURN VALUE { device: device, live: $before.expires_at > $ended_at };
