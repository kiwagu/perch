-- Whether the second factor of identity $identity (its key) is on, and its two-factor rows as
-- Better Auth's adapter wrote them: each row's key, verified or not, the encrypted secret and
-- backup codes.
RETURN {
  enabled: (
    SELECT VALUE two_factor_enabled
    FROM ONLY type::record('identity', $identity)
  ),
  rows: (
    SELECT
      record::id(id) AS id,
      verified,
      secret,
      backup_codes
    FROM two_factor
    WHERE identity = $identity
  ),
};
