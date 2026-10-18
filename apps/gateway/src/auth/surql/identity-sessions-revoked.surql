-- Identity $identity (its key) is signed out everywhere from the start of the second of $at, or
-- of now when $at is NONE: the tokens issued in an earlier second are refused from now on. A
-- token carries the second it was issued in, so a sign-in in the same second as the sign-out
-- is accepted; a token issued in that second before the sign-out lives until it expires, while
-- its grant and its device's row are revoked with the rest.
UPDATE type::record('identity', $identity) SET
  sessions_revoked_at = time::floor($at ?? time::now(), 1s);
