-- Ends every live session of identity $identity (its key) at $ended_at; an ended row keeps its end.
UPDATE device_session SET
  ended_at = ended_at ?? $ended_at,
  expires_at = $ended_at
WHERE
  identity = $identity
  AND expires_at > $ended_at;
