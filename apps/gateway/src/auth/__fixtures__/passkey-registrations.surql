-- The passkeys of identity $identity (its key), by their ids, and its passkeys' pending
-- registrations, by their identifiers: the rows of `verification` whose JSON value names the
-- identity as `userData.id`, as Better Auth's passkey plugin writes a registration's challenge.
RETURN {
  passkeys: (SELECT VALUE record::id(id) FROM passkey WHERE identity = $identity),
  registrations: (
    SELECT VALUE identifier
    FROM verification
    WHERE string::contains(`value`, string::concat('"userData":{"id":"', $identity, '"'))
  ),
};
