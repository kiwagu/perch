-- The platform role and the ban of identity $identity.
SELECT
  role,
  banned,
  ban_reason
FROM ONLY type::record('identity', $identity);
