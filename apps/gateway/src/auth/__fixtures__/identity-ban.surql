-- Bans identity $identity (its key) directly, as an operator's ban does, in one transaction: the
-- flag set, and every session of the identity not ended already, a waiting one included, ended at
-- $ended_at (an expired one at its expiry) with `banned` as its reason.
BEGIN TRANSACTION;
  UPDATE type::record('identity', $identity) SET banned = true RETURN NONE;
  UPDATE device_session SET
    ended_reason = 'banned',
    ended_at = time::min([expires_at, $ended_at]),
    expires_at = time::min([expires_at, $ended_at])
  WHERE
    identity = $identity
    AND ended_at = NONE
  RETURN NONE;
COMMIT TRANSACTION;
