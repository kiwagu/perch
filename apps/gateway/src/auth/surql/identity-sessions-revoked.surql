-- Identity $identity (its key): the tokens issued before $at, or before now when $at is NONE,
-- are refused from now on.
UPDATE type::record('identity', $identity) SET
  sessions_revoked_at = $at ?? time::now();
