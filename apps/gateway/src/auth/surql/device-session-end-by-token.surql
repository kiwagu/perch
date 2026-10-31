-- Ends the session that holds token $session_token at $ended_at unless it was ended already, live
-- or expired: an expired one is marked ended at its expiry, which stays, so no late extension of
-- it can take hold. Answers `true` when it ended a session that was live until now, `false` when
-- the session had expired, and nothing when no session holds the token or it was ended already.
-- (`$token` is a protected variable, so the token goes by another name.)
UPDATE device_session SET
  ended_at = ended_at ?? time::min([expires_at, $ended_at]),
  expires_at = time::min([expires_at, $ended_at])
WHERE
  token = $session_token
  AND ended_at = NONE
RETURN VALUE $before.expires_at > $ended_at;
