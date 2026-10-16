-- Removes every seeded account, addressed to the seed domain, with its profile and
-- the documents of its private region (`user:<account key>`). Only seed data uses
-- that domain, so real accounts never match.
LET $accounts = SELECT VALUE id
FROM user
WHERE string::ends_with(email, string::concat('@', $domain));
LET $regions = $accounts.map(
  |$account| string::concat('user:', record::id($account))
);
DELETE profile WHERE user IN $accounts;
DELETE _replica_snapshot WHERE region IN $regions;
DELETE _replica_update WHERE region IN $regions;
DELETE _replica_outbox WHERE region IN $regions;
DELETE user WHERE id IN $accounts;
