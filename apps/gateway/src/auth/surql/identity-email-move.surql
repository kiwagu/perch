-- Changes the email of identity $identity (its key) from $from to $to, both in lower case, and
-- ends every reset link of the identity, which went to the old email, as one transaction:
-- answers the new email, or NONE, nothing changed, when the identity is gone or its email is no
-- longer $from.
BEGIN TRANSACTION;
LET $moved = (
  UPDATE ONLY type::record('identity', $identity) SET
    email = $to,
    updated_at = time::now()
  WHERE email = $from
  RETURN VALUE email
);
IF $moved != NONE {
  DELETE verification
  WHERE
    `value` = $identity
    AND string::starts_with(identifier, 'reset-password:')
  RETURN NONE;
};
RETURN $moved;
COMMIT TRANSACTION;
