-- The seeded accounts on a stand: every account addressed to the seed domain, or only
-- those of them at `$emails` when it is given.
SELECT VALUE id
FROM identity
WHERE
  string::ends_with(email, string::concat('@', $domain))
  AND (
    $emails = NONE
    OR email IN $emails
  );
