-- The key of the profile of identity $identity (its key), as the region hub projected it into the
-- directory: none until a device's start reached the identity's private region. A profile under
-- any id is found, by the index on its identity.
SELECT VALUE record::id(id)
FROM profile
WHERE identity = type::record('identity', $identity)
LIMIT 1;
