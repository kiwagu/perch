-- Spends the pending change of the email of identity $identity (its key) whose link carries $jti:
-- answers the row it deleted, or nothing when no change of the identity is pending under that
-- link (used before, replaced by a newer one, or ended by a change of the password). A change is
-- spent once, however many claims of it run at once.
DELETE verification
WHERE
  identifier = string::concat('change-email:', $identity)
  AND `value` = $jti
RETURN BEFORE;
