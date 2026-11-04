-- Spends the pending deletion of the account of identity $identity (its key) whose link carries
-- $jti: answers the row it deleted, or nothing when no deletion of the identity is pending under
-- that link (used before, replaced by a newer one, or ended by a change of the password or of the
-- email). A deletion is spent once, however many claims of it run at once.
DELETE verification
WHERE
  identifier = string::concat('delete-account:', $identity)
  AND `value` = $jti
RETURN BEFORE;
