-- The identity (its key) whose email is $email, in any case, the hash on its credential row, the
-- name and the language it signed up with, and whether it has started (its profile and its
-- settings both reached the directory through its private region), or NONE when no account has the
-- email: what a sign-in reads before Better Auth checks the password and again once Better Auth
-- wrote the session.
SELECT
  record::id(id) AS identity,
  name,
  locale,
  (
    SELECT VALUE password
    FROM account
    WHERE
      identity = record::id($parent.id)
      AND provider_id = 'credential'
    LIMIT 1
  )[0] AS hash,
  array::len(
    (
      SELECT VALUE id
      FROM profile
      WHERE identity = $parent.id
      LIMIT 1
    )
  ) > 0
  AND array::len(
    (
      SELECT VALUE id
      FROM settings
      WHERE identity = $parent.id
      LIMIT 1
    )
  ) > 0 AS started
FROM ONLY identity
WHERE email = string::lowercase($email)
LIMIT 1;
