-- Deletes at most $limit passkey ceremonies that expired more than a minute ago: the rows of
-- `verification` Better Auth's passkey plugin writes for the options of a registration or of a
-- sign-in (their JSON value opens with `{"type":"registration",` or `{"type":"authentication",`),
-- which a ceremony left unfinished (its browser window closed) leaves behind, since Better Auth's
-- own clean-up of expired rows is off to keep a reset link readable as expired. Better Auth judges
-- a ceremony's expiry by its own process's clock: the minute keeps one it still takes out of reach
-- of a database clock a little ahead. No row of another kind (a reset link, a pending change of an
-- email or deletion of an account, a two-factor challenge or the count of its codes) matches. The
-- limit bounds the deletions only: `verification` is indexed by its identifier alone, so finding
-- the rows reads them by expiry and value, every one while fewer than $limit match.
DELETE (
  SELECT VALUE id
  FROM verification
  WHERE
    expires_at < time::now() - 1m
    AND (
      string::starts_with(`value`, '{"type":"registration",')
      OR string::starts_with(`value`, '{"type":"authentication",')
    )
  LIMIT $limit
)
RETURN NONE;
