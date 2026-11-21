-- Turns the second factor of identity $identity (its key) on, as a confirmation of a code of its
-- key commits it: the flag on the account, and its two-factor row verified.
UPDATE type::record('identity', $identity) SET
  two_factor_enabled = true
RETURN NONE;
UPDATE two_factor SET verified = true WHERE identity = $identity RETURN NONE;
