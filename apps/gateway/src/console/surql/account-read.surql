-- The account of identity $identity (its key) for an operator, read in one snapshot, or NONE when
-- no account has it: its email, whether it is verified, when it was made, its platform role, its
-- ban and the reason given, whether it has a profile and its shown name (the profile's, or the
-- name it signed up with while it has none), when one of its devices was last seen, and its
-- organisations with its role in each, by key.
--
-- Last seen is the latest among its session rows still kept, ended ones included (they stay until
-- swept), as the admission takes it (`time::max`); a sign-in still waiting for its admission was
-- never handed to its device, and an account never signed in has none. An organisation still
-- provisioning is nobody's yet; the order names the projected `key`, as the rows it sorts no
-- longer hold `tenant`.
BEGIN TRANSACTION;
  LET $account = type::record('identity', $identity);
  LET $row = (
    SELECT
      email,
      email_verified,
      name,
      created_at,
      role,
      banned,
      ban_reason
    FROM ONLY $account
  );
  LET $profile = (
    SELECT VALUE name
    FROM profile
    WHERE identity = $account
    LIMIT 1
  )[0];
  LET $seen = (
    SELECT VALUE last_seen_at
    FROM device_session
    WHERE
      identity = $identity
      AND pending = false
  );
  LET $organisations = (
    SELECT
      role,
      tenant.key AS key,
      tenant.name AS name
    FROM membership
    WHERE
      identity = $account
      AND tenant.status = 'ready'
    ORDER BY key
  );
  RETURN IF $row = NONE {
    NONE;
  } ELSE {
    {
      id: $account,
      email: $row.email,
      email_verified: $row.email_verified,
      name: $profile ?? $row.name,
      has_profile: $profile != NONE,
      created_at: $row.created_at,
      last_seen: IF array::len($seen) = 0 {
        NONE;
      } ELSE {
        time::max($seen);
      },
      role: $row.role,
      banned: $row.banned,
      ban_reason: $row.ban_reason,
      organisations: $organisations,
    };
  };
COMMIT TRANSACTION;
