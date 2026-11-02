-- Ends the pending change of the email of identity $identity (its key), if any: its link changes
-- nothing from now on.
DELETE verification
WHERE identifier = string::concat('change-email:', $identity)
RETURN NONE;
