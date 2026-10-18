-- Identity $identity (its key): the tokens issued before $at are refused from now on.
UPDATE type::record('identity', $identity) SET sessions_revoked_at = $at;
