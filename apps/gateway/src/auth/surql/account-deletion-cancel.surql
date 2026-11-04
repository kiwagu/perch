-- Ends the pending deletion of the account of identity $identity (its key), if any: its link
-- deletes nothing from now on.
DELETE verification
WHERE identifier = string::concat('delete-account:', $identity)
RETURN NONE;
