-- The memberships of identity $identity in the organisation with key $key.
SELECT role
FROM membership
WHERE
  identity = $identity
  AND tenant.key = $key;
