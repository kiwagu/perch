-- Sets $hash as the password hash of identity $identity (its key), on its credential row: answers
-- the row's id, or nothing when the identity has no credential row.
UPDATE account SET
  password = $hash,
  updated_at = time::now()
WHERE
  identity = $identity
  AND provider_id = 'credential'
RETURN VALUE id;
