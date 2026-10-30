-- Identity $identity (its key) loses its refresh grant $grant of the `identity` access method;
-- nothing changes when the grant is not the identity's or is revoked already. The grant goes
-- as a parameter of the filter: `REVOKE GRANT` takes no parameter.
ACCESS identity ON DATABASE REVOKE
WHERE
  subject.record = type::record('identity', $identity)
  AND grant.id = $grant;
