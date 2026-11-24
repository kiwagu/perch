-- Turns off the second factor of identity $identity (its key) as one transaction: the account's
-- flag off, its two-factor row and its backup codes gone, and its pending two-factor challenges
-- ended with the rows counting their codes (`fn::two_factor_challenges_end`), so no code is taken
-- for a challenge that stood for the factor. An account whose factor is off already changes
-- nothing but a key still waiting for its code, which goes too. A failure of any write leaves all
-- of them undone.
BEGIN TRANSACTION;
  UPDATE ONLY type::record('identity', $identity) SET
    two_factor_enabled = false,
    updated_at = time::now()
  WHERE two_factor_enabled = true
  RETURN NONE;
  DELETE two_factor WHERE identity = $identity RETURN NONE;
  fn::two_factor_challenges_end($identity);
COMMIT TRANSACTION;
