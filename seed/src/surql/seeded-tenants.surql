-- The databases of the organisations the seeded accounts created: the accounts are the ones
-- `seeded-accounts.surql` selects (every account addressed to the seed domain, or only those
-- of them at `$emails` when it is given).
SELECT VALUE database
FROM tenant
WHERE
  created_by IN (
    SELECT VALUE id
    FROM identity
    WHERE
      string::ends_with(email, string::concat('@', $domain))
      AND (
        $emails = NONE
        OR email IN $emails
      )
  );
