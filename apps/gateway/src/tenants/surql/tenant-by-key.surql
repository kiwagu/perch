-- The organisation with key $key, or NONE.
SELECT
  id,
  key,
  name,
  database,
  status,
  created_by
FROM ONLY tenant
WHERE key = $key
LIMIT 1;
