-- Writes a row of `verification` under identifier $identifier, holding $value until $expires_at, as
-- Better Auth and the gateway write theirs.
CREATE verification SET
  identifier = $identifier,
  `value` = $value,
  expires_at = $expires_at
RETURN NONE;
