-- Changes the password of identity $identity (its key) to $hash at $ended_at, as one transaction,
-- for the caller's session $keep (its key), once its current password was checked against
-- $verified_hash: the session must still be live, else `unauthorized`, and the credential row
-- must still hold $verified_hash, else `wrong-password`, and nothing changes. Once both hold,
-- $hash becomes the password, every reset link of the identity is deleted, every other session
-- not ended already ends at $ended_at (an expired one at its expiry), and the pending change of
-- email is deleted. Answers `{ outcome, ended }`: `changed` with, for each session it marked, its
-- device and whether it was live until now. A failure of any write leaves all of them undone.
BEGIN TRANSACTION;
LET $live = (
  SELECT VALUE id
  FROM device_session
  WHERE
    id = type::record('device_session', $keep)
    AND identity = $identity
    AND ended_at = NONE
    AND expires_at > $ended_at
);
LET $current = (
  SELECT VALUE password
  FROM account
  WHERE
    identity = $identity
    AND provider_id = 'credential'
  LIMIT 1
)[0];
LET $outcome = IF array::len($live) = 0 {
  'unauthorized'
} ELSE IF $current != $verified_hash {
  'wrong-password'
} ELSE {
  'changed'
};
IF $outcome = 'changed' {
  UPDATE account SET
    password = $hash,
    updated_at = time::now()
  WHERE
    identity = $identity
    AND provider_id = 'credential'
  RETURN NONE;
  DELETE verification
  WHERE
    `value` = $identity
    AND string::starts_with(identifier, 'reset-password:')
  RETURN NONE;
};
LET $ended = IF $outcome = 'changed' {
  (
    UPDATE device_session SET
      ended_at = ended_at ?? time::min([expires_at, $ended_at]),
      expires_at = time::min([expires_at, $ended_at])
    WHERE
      identity = $identity
      AND ended_at = NONE
      AND id != type::record('device_session', $keep)
    RETURN VALUE { device: device, live: $before.expires_at > $ended_at }
  )
} ELSE {
  []
};
IF $outcome = 'changed' {
  DELETE verification WHERE identifier = string::concat('change-email:', $identity) RETURN NONE;
};
RETURN { outcome: $outcome, ended: $ended };
COMMIT TRANSACTION;
