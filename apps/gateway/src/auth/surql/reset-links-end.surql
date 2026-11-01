-- Ends every reset link of identity $identity (its key): the rows Better Auth keeps under an
-- identifier `reset-password:<token>` with the identity's key as their value are deleted.
DELETE verification
WHERE
  `value` = $identity
  AND string::starts_with(identifier, 'reset-password:')
RETURN NONE;
