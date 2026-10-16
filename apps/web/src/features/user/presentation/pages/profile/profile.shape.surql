-- The profile page reads the signed-in user's profile from the private region.
-- @params $user: record<user>
SELECT
  id,
  name,
  email,
  bio,
  locale,
  created_at
FROM profile
WHERE user = $user
LIMIT 1;
