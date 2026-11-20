-- The ban of identity $identity (its key) as the directory keeps it: whether it is banned, the
-- reason given and when it would lift by itself.
SELECT
  banned,
  ban_reason,
  ban_expires
FROM ONLY type::record('identity', $identity);
