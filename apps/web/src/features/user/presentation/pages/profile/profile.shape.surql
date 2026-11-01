-- The profile page reads the signed-in user's profile from the private region.
-- @params $identity: record<identity>
SELECT
  id,
  name,
  email,
  bio,
  created_at
FROM profile
WHERE identity = $identity
LIMIT 1;
