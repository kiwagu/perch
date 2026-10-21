-- The member rows the seeded accounts have in the databases of organisations they did not
-- create, one per membership: the account's key and the organisation's database. The accounts
-- are the ones `seeded-accounts.surql` selects (every account addressed to the seed domain, or
-- only those of them at `$emails` when it is given); the organisations they created go whole,
-- with their databases. Only databases that exist: one still provisioning may have none yet.
SELECT VALUE { identity: record::id(identity), database: tenant.database }
FROM membership
WHERE
  string::ends_with(identity.email ?? '', string::concat('@', $domain))
  AND (
    $emails = NONE
    OR identity.email IN $emails
  )
  AND !(
    string::ends_with(
      tenant.created_by.email ?? '',
      string::concat('@', $domain)
    )
    AND (
      $emails = NONE
      OR tenant.created_by.email IN $emails
    )
  )
  AND tenant.database IN object::keys(
    (
      INFO FOR NS
    ).databases
  );
