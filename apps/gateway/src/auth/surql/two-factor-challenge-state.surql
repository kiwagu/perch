-- What Better Auth judges the pending two-factor challenge under identifier $identifier by when a
-- code comes for it: the expiry of the challenge's own row, and the count of codes and the expiry
-- of the row counting them (`2fa-attempts-` before the identifier); NONE for a row that is gone.
RETURN {
  expires_at: (
    SELECT VALUE expires_at
    FROM ONLY verification
    WHERE identifier = $identifier
    LIMIT 1
  ),
  attempts: (
    SELECT
      `value`,
      expires_at
    FROM ONLY verification
    WHERE identifier = string::concat('2fa-attempts-', $identifier)
    LIMIT 1
  )
};
