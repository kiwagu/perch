-- The second factor of identity $identity (its key): whether it is on, and its two-factor row,
-- which Better Auth's enable keeps one of at most: the row's key, the encrypted secret and whether
-- a code of the key confirmed it. No `row` for an account that has not started to turn it on.
RETURN {
  enabled: (
    SELECT VALUE two_factor_enabled
    FROM ONLY type::record('identity', $identity)
  ) ?? false,
  row: (
    SELECT
      record::id(id) AS id,
      secret,
      verified
    FROM two_factor
    WHERE identity = $identity
    LIMIT 1
  )[0],
};
