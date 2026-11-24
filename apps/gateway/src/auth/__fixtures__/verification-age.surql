-- Moves the expiry of the rows of `verification` whose identifiers are $identifiers to $at: Better
-- Auth judges a row's expiry by the system clock, which a spec's clocks do not move.
UPDATE verification SET
  expires_at = $at
WHERE identifier IN $identifiers
RETURN NONE;
