-- Identity $identity (its key) loses every refresh grant of the `identity` access method.
ACCESS identity ON DATABASE REVOKE WHERE subject.record = type::record('identity', $identity);
