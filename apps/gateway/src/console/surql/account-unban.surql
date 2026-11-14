-- Lifts the ban of the account of identity $identity (its key), in one transaction: the account is
-- no longer banned, and keeps no reason and no lapse of a ban. Nothing else changes: the sessions
-- the ban ended stay ended, and an account that was not banned stays as it is. Answers `unbanned`,
-- or `gone`, changing nothing, when no account has the identity.
BEGIN TRANSACTION;
  LET $account = type::record('identity', $identity);
  LET $outcome = IF record::exists($account) {
    'unbanned';
  } ELSE {
    'gone';
  };
  IF $outcome = 'unbanned' {
    UPDATE $account SET
      banned = false,
      ban_reason = NONE,
      ban_expires = NONE
    RETURN NONE;
  };
  RETURN $outcome;
COMMIT TRANSACTION;
