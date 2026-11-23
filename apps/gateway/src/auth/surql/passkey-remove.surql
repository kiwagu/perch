-- Removes passkey $passkey (its key) of identity $identity (its key), and answers each row it
-- removed as it was: none for a passkey that is not, or no longer, the identity's.
DELETE type::record('passkey', $passkey)
WHERE identity = $identity
RETURN BEFORE;
