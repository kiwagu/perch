-- Deletes at most $limit passkey ceremonies that expired more than a minute ago: the rows of
-- `verification` Better Auth's passkey plugin writes for the options of a registration or of a
-- sign-in (`ceremony` `passkey`, derived by the schema from their JSON value), which a ceremony left
-- unfinished (its browser window closed) leaves behind, since Better Auth's own clean-up of expired
-- rows is off to keep a reset link readable as expired. Better Auth judges a ceremony's expiry by
-- its own process's clock: the minute keeps one it still takes out of reach of a database clock a
-- little ahead. No row of another kind (a reset link, a pending change of an email or deletion of
-- an account, a two-factor challenge or the count of its codes) matches. The rows are found through
-- the index of the ceremonies' expiry (`verification_ceremony_expiry`), the earliest expired first,
-- so the read is of the rows it deletes and no other.
DELETE (
  SELECT VALUE id
  FROM verification
  WHERE
    ceremony = 'passkey'
    AND expires_at < time::now() - 1m
  LIMIT $limit
)
RETURN NONE;
