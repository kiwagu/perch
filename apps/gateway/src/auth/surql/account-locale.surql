-- The language the settings of identity $identity (its key) name, or NONE before the account has
-- settings: they arrive through the identity's region after its first sign-in.
SELECT VALUE locale
FROM ONLY settings
WHERE identity = type::record('identity', $identity)
LIMIT 1;
