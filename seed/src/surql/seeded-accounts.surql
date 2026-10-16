-- The seeded accounts on a stand: every account addressed to the seed domain.
SELECT VALUE id
FROM identity
WHERE string::ends_with(email, string::concat('@', $domain));
