-- The password hash on the credential row of identity $identity (its key), or NONE when it has
-- none.
SELECT VALUE password
FROM account
WHERE
  identity = $identity
  AND provider_id = 'credential'
LIMIT 1;
