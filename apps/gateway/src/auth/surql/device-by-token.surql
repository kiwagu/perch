-- The session row holding token $session_token, or NONE. (`$token` is a protected variable, so
-- the token goes by another name.)
SELECT * FROM ONLY device_session WHERE token = $session_token LIMIT 1;
