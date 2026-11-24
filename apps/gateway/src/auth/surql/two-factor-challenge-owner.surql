-- The value of the row Better Auth keeps under identifier $identifier, or NONE: for a pending
-- two-factor challenge (`2fa-<random>`), the key of the identity whose password step it answered.
SELECT VALUE `value`
FROM ONLY verification
WHERE identifier = $identifier
LIMIT 1;
