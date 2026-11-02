-- The email identity $identity (its key) has now, and the key of its profile as the directory
-- holds it once a device's start reached the identity's private region (NONE before), or NONE
-- when the identity is gone.
SELECT
  email,
  (
    SELECT VALUE record::id(id)
    FROM profile
    WHERE identity = $parent.id
    LIMIT 1
  )[0] AS profile
FROM ONLY type::record('identity', $identity);
