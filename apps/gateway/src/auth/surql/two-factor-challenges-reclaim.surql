-- Ends the two-factor challenges whose rows expired more than a minute ago, reading at most $limit
-- of those rows: a password step's challenge (`2fa-<random>`) and the row counting its codes
-- (`2fa-attempts-2fa-<random>`), both `ceremony` `two-factor`, written together with one expiry,
-- which a sign-in left at its code step (the device closed) leaves behind, since Better Auth's own
-- clean-up of expired rows is off to keep a reset link readable as expired. Each row found ends its
-- challenge with the row counting its codes (`fn::two_factor_challenge_end`), a count whose
-- challenge is gone included. Better Auth judges a challenge's expiry by its own process's clock:
-- the minute keeps one it still takes out of reach of a database clock a little ahead. No row of
-- another kind (a reset link, a pending change of an email or deletion of an account, a passkey
-- ceremony) matches. The rows are found through the index of the ceremonies' expiry
-- (`verification_ceremony_expiry`), the earliest expired first, so the read is of the rows it
-- ends and no other.
FOR $identifier IN (
  SELECT VALUE identifier
  FROM verification
  WHERE
    ceremony = 'two-factor'
    AND expires_at < time::now() - 1m
  LIMIT $limit
) {
  fn::two_factor_challenge_end(
    IF string::starts_with($identifier, '2fa-attempts-') {
      string::slice($identifier, string::len('2fa-attempts-'));
    } ELSE {
      $identifier;
    }
  );
};
