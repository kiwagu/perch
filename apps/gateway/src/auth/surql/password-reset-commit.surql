-- Resets the password of identity $identity (its key) with the reset link whose token is
-- $link_token, at $ended_at, as one transaction: the link must still be the identity's and live
-- at $ended_at, else nothing changes and the answer says why (`link-invalid`, `link-expired`).
-- Once it is, every reset link of the identity is deleted (this one spent with them), $hash
-- becomes the password of its credential row, every session of the identity not ended already
-- ends at $ended_at (an expired one at its expiry), and its pending change of email is deleted;
-- the answer is `reset`. A failure of any of these leaves all of them undone.
BEGIN TRANSACTION;
LET $link = (
  SELECT `value` AS identity, expires_at
  FROM ONLY verification
  WHERE identifier = string::concat('reset-password:', $link_token)
  LIMIT 1
);
LET $outcome = IF $link = NONE OR $link.identity != $identity {
  'link-invalid'
} ELSE IF $link.expires_at <= $ended_at {
  'link-expired'
} ELSE {
  'reset'
};
IF $outcome = 'reset' {
  DELETE verification
  WHERE
    `value` = $identity
    AND string::starts_with(identifier, 'reset-password:')
  RETURN NONE;
  LET $set = (
    UPDATE account SET
      password = $hash,
      updated_at = time::now()
    WHERE
      identity = $identity
      AND provider_id = 'credential'
    RETURN VALUE id
  );
  IF array::len($set) = 0 {
    THROW 'the account has no password to set';
  };
  UPDATE device_session SET
    ended_at = ended_at ?? time::min([expires_at, $ended_at]),
    expires_at = time::min([expires_at, $ended_at])
  WHERE
    identity = $identity
    AND ended_at = NONE
  RETURN NONE;
  DELETE verification WHERE identifier = string::concat('change-email:', $identity) RETURN NONE;
};
RETURN $outcome;
COMMIT TRANSACTION;
