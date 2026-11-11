-- A page of the platform's accounts for an operator: those whose email or shown name holds $q in
-- any case ('' for every account), the newest first and two made at the same instant by their id,
-- page $page (from 1) of $size accounts, with the number of them all, the page and the number from
-- one snapshot. An account's shown name is its profile's name, or the name it signed up with while
-- it has no profile; a profile whose identity is gone makes no account.
--
-- Each identity meets its profile by grouping the rows of both tables by account, one pass over
-- each table. A subquery per identity (`WHERE identity = $parent.id`) would scan every profile for
-- each identity (the planner takes no index for a value of the outer row), and a map of the names
-- held in a parameter is copied for each row that reads it: either grows with the square of the
-- accounts. The rows of both tables are joined with `+`: `array::concat` refuses an answer over
-- 1 MiB, and the formatter drops the comma of a `FROM` naming two tables.
BEGIN TRANSACTION;
  LET $needle = string::lowercase($q);
  LET $identities = (
    SELECT
      id AS account,
      [
        {
          email: email,
          email_verified: email_verified,
          banned: banned,
          role: role,
          created_at: created_at,
          name: name,
        },
      ] AS identities,
      [] AS profiles
    FROM identity
  );
  LET $profiles = (
    SELECT
      identity AS account,
      [] AS identities,
      [name] AS profiles
    FROM profile
  );
  LET $accounts = (
    SELECT
      account,
      array::flatten(array::group(identities)) AS identities,
      array::flatten(array::group(profiles)) AS profiles
    FROM $identities + $profiles
    GROUP BY account
  );
  LET $found = (
    SELECT
      account AS id,
      identities[0].email AS email,
      identities[0].email_verified AS email_verified,
      identities[0].banned AS banned,
      identities[0].role AS role,
      identities[0].created_at AS created_at,
      profiles[0] ?? identities[0].name AS name
    FROM $accounts
    WHERE
      identities[0] != NONE
      AND (
        string::contains(string::lowercase(identities[0].email), $needle)
        OR string::contains(
          string::lowercase(profiles[0] ?? identities[0].name),
          $needle
        )
      )
  );
  LET $start = ($page - 1) * $size;
  RETURN {
    page: (
      SELECT *
      FROM $found
      ORDER BY created_at DESC, id DESC
      LIMIT $size
      START $start
    ),
    total: array::len($found),
  };
COMMIT TRANSACTION;
