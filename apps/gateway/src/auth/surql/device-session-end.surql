-- Ends session $id of identity $identity (its key) at $ended_at, if it is live; a session that
-- ended already keeps its end, and one that expired is marked ended at its expiry. Answers the
-- row and whether this statement ended it (`ended`), or NONE when the identity has no such
-- session.
UPDATE ONLY type::record('device_session', $id) SET
  ended_at = ended_at ?? time::min([expires_at, $ended_at]),
  expires_at = time::min([expires_at, $ended_at])
WHERE identity = $identity
RETURN VALUE { row: $after, ended: $before.expires_at > $ended_at };
