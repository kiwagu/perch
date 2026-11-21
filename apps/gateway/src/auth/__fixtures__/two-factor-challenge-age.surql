-- Sets the expiry of every row Better Auth keeps for a pending two-factor challenge (the challenge's
-- own row and the row counting its codes) to $at: a challenge aged past its ten minutes, as Better
-- Auth judges its age by the system clock, which a test's clock does not move.
UPDATE verification SET
  expires_at = $at
WHERE string::starts_with(identifier, '2fa-')
RETURN NONE;
