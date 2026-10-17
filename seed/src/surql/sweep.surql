-- Teardown for seeded accounts: an operator task on a stand, not a product command.
-- Removes the accounts addressed to the seed domain (only those of them at `$emails` when
-- it is given) with their profiles and the server's copy of their private regions
-- (`identity:<account key>`): heads, snapshots, the update log and the projected keys.
-- Only seed data uses that domain, so real accounts never match. The organisations the
-- accounts created go too: their memberships, their databases `t_<key>` and their rows in
-- the directory; the accounts' memberships in organisations of others are deleted too.
LET $accounts = SELECT VALUE id
FROM identity
WHERE
  string::ends_with(email, string::concat('@', $domain))
  AND (
    $emails = NONE
    OR email IN $emails
  );
LET $regions = $accounts.map(
  |$account| string::concat('identity:', record::id($account))
);
-- Account by account, like the update log below: the unique index of a membership starts
-- with the identity, and `identity IN $accounts` deletes nothing on it.
FOR $account IN $accounts {
  DELETE membership WHERE identity = $account;
};
LET $tenants = SELECT VALUE id FROM tenant WHERE created_by IN $accounts;
DELETE membership WHERE tenant IN $tenants;
-- The databases first, while the `tenant` rows that name them exist.
FOR $database IN (
  SELECT VALUE database
  FROM tenant
  WHERE created_by IN $accounts
) {
  REMOVE DATABASE IF EXISTS $database;
};
DELETE tenant WHERE created_by IN $accounts;
DELETE profile WHERE identity IN $accounts;
DELETE _replica_head WHERE region IN $regions;
DELETE _replica_snapshot WHERE region IN $regions;
-- Region by region: SurrealDB 3.3.4 deletes nothing for `region IN $regions` on a table whose
-- composite index starts with the region, though a SELECT finds the rows.
FOR $region IN $regions {
  DELETE _replica_update WHERE region = $region;
};
DELETE _replica_projected WHERE region IN $regions;
DELETE identity WHERE id IN $accounts;
