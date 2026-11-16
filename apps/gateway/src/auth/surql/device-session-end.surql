-- Ends session $id of identity $identity (its key) at $ended_at, if it is live: another device
-- signed it out, which the row keeps as its reason (`revoked`) for the device's next hello. A
-- session that ended already keeps its end and its reason, and one that expired is marked ended
-- at its expiry, with no reason. Answers the row and whether this statement ended it (`ended`),
-- or NONE when the identity has no such session. The reason is set first, from the row as it was.
UPDATE ONLY type::record('device_session', $id) SET
  ended_reason = IF ended_at = NONE
  AND expires_at > $ended_at {
    'revoked';
  } ELSE {
    ended_reason;
  },
  ended_at = ended_at ?? time::min([expires_at, $ended_at]),
  expires_at = time::min([expires_at, $ended_at])
WHERE identity = $identity
RETURN VALUE { row: $after, ended: $before.expires_at > $ended_at };
