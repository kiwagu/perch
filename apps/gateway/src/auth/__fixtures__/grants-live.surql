-- The refresh grants of identity $identity (its key) that are not revoked.
ACCESS identity ON DATABASE SHOW
WHERE
  subject.record = type::record('identity', $identity)
  AND revocation = NONE;
