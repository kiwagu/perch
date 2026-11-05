-- Spends the pending deletion of the account of identity $identity (its key) whose link carries
-- $jti: answers the row it deleted, or nothing when no deletion of the identity is pending under
-- that link (used before, replaced by a newer one, or ended by a change of the password or of the
-- email) or its link expired by $now, the gateway's clock (never the database's own time, so the
-- deadline is the one the link was given). A deletion is spent once, however many claims of it
-- run at once.
DELETE verification
WHERE
  identifier = string::concat('delete-account:', $identity)
  AND `value` = $jti
  AND expires_at > $now
RETURN BEFORE;
