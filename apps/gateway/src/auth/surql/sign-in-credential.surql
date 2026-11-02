-- The identity (its key) whose email is $email, in any case, and the hash on its credential row,
-- or NONE when no account has the email: what a sign-in reads before Better Auth checks the
-- password and again once Better Auth wrote the session.
SELECT
  record::id(id) AS identity,
  (
    SELECT VALUE password
    FROM account
    WHERE
      identity = record::id($parent.id)
      AND provider_id = 'credential'
    LIMIT 1
  )[0] AS hash
FROM ONLY identity
WHERE email = string::lowercase($email)
LIMIT 1;
