-- Bans the account of identity $identity (its key) at $now, in one transaction, until an operator
-- lifts the ban: the account is marked banned with the reason $reason (NONE when none was given),
-- with no lapse, and every session of it not ended already ends at $now with `banned` as its
-- reason, a sign-in still waiting for its admission included, and an expired one at its expiry,
-- as every ending marks one. So whichever of the ban and a sign-in's or a verification's admission
-- commits second sees the other: each admission reads the ban in its own transaction. An account
-- banned already keeps its ban with the reason given now; its sessions ended with the first ban,
-- and no admission has let one in since. Answers `banned`, or `gone`, changing nothing, when no
-- account has the identity. A failure of any write leaves all of them undone.
BEGIN TRANSACTION;
  LET $account = type::record('identity', $identity);
  LET $outcome = IF record::exists($account) {
    'banned';
  } ELSE {
    'gone';
  };
  IF $outcome = 'banned' {
    UPDATE $account SET
      banned = true,
      ban_reason = $reason,
      ban_expires = NONE
    RETURN NONE;
    UPDATE device_session SET
      ended_reason = 'banned',
      ended_at = time::min([expires_at, $now]),
      expires_at = time::min([expires_at, $now])
    WHERE
      identity = $identity
      AND ended_at = NONE
    RETURN NONE;
  };
  RETURN $outcome;
COMMIT TRANSACTION;
