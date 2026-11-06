-- Ends the session that holds token $session_token at $ended_at with reason $reason, as an ending
-- from elsewhere leaves it while its device is offline. (`$token` is a protected variable.)
UPDATE device_session SET
  ended_reason = $reason,
  ended_at = $ended_at,
  expires_at = $ended_at
WHERE token = $session_token;
