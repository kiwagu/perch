-- Moves the end of the session that holds token $session_token to $ends_at: a past instant ends
-- it then, a future one keeps it live until then. (`$token` is a protected variable.)
UPDATE device_session SET expires_at = $ends_at WHERE token = $session_token;
