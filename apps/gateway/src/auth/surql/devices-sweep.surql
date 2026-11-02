-- Forgets the session rows of identity $identity (its key) whose session ended at $before or
-- earlier.
DELETE device_session
WHERE
  identity = $identity
  AND expires_at <= $before
RETURN NONE;
