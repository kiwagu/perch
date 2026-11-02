-- The identity (its key) and the expiry of the reset link whose token is $link_token, or NONE for a
-- token no link holds: Better Auth keeps a reset link under the identifier
-- `reset-password:<token>`, the identity's key as its value, until it is used or replaced.
SELECT `value` AS identity, expires_at
FROM ONLY verification
WHERE identifier = string::concat('reset-password:', $link_token)
LIMIT 1;
