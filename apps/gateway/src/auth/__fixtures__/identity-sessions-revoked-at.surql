-- The moment identity $identity (its key) was signed out everywhere, or NONE.
SELECT VALUE sessions_revoked_at FROM ONLY type::record('identity', $identity);
