-- The passkeys of identity $identity (its key), the earliest added first, passkeys added at the
-- same instant by their key: each its key and when it was added.
SELECT record::id(id) AS id,
created_at
FROM passkey
WHERE identity = $identity
ORDER BY created_at, id;
