-- The second factor of an account: Better Auth's two-factor model, one row per account at most,
-- written by its enable (which deletes the account's row and writes a new one, its key not yet
-- confirmed) and by the confirmation of a code of that key. It keeps the key's secret and the
-- account's backup codes, both encrypted with Better Auth's secret. Server-only, written by the
-- gateway as the namespace user; nobody reads it directly.
--
-- A challenge a sign-in by password answers for an account whose factor is on is not kept here:
-- Better Auth keeps it in `verification`, under `2fa-<random>` with the identity's key as its value,
-- beside the row counting its codes, `2fa-attempts-2fa-<random>`. The functions below end them.

-- @replicate none
-- @id tfa
DEFINE TABLE OVERWRITE two_factor SCHEMAFULL
  PERMISSIONS
    FOR select, create, update, delete NONE;

-- The key of the identity, as Better Auth's adapter writes and compares a reference: a plain
-- string, not a record id.
DEFINE FIELD OVERWRITE identity ON two_factor TYPE string;
-- The secret of the key an authenticator app reads, encrypted.
DEFINE FIELD OVERWRITE secret ON two_factor TYPE string;
-- The backup codes not used yet, as one encrypted list: a code used is taken out of it.
DEFINE FIELD OVERWRITE backup_codes ON two_factor TYPE string;
-- Whether a code of the key confirmed it: Better Auth's enable writes false (true when it replaces
-- a confirmed key), its confirmation true. A row written without it counts as confirmed, as
-- Better Auth's own default has it.
DEFINE FIELD OVERWRITE verified ON two_factor TYPE bool DEFAULT true;
-- Better Auth's own count of wrong codes and the lock it sets after too many: its lockout is off
-- (the gateway counts a sign-in's wrong codes with its wrong passwords), so it writes neither.
DEFINE FIELD OVERWRITE failed_verification_count ON two_factor TYPE option<int>;
DEFINE FIELD OVERWRITE locked_until ON two_factor TYPE option<datetime>;

DEFINE INDEX OVERWRITE two_factor_identity ON two_factor FIELDS identity;

-- Ends the pending two-factor challenge whose identifier is $identifier: its row and the row
-- counting its codes. Ending one that is gone ends nothing.
DEFINE FUNCTION OVERWRITE fn::two_factor_challenge_end($identifier: string) {
  DELETE verification WHERE identifier = $identifier RETURN NONE;
  DELETE verification
  WHERE identifier = string::concat('2fa-attempts-', $identifier)
  RETURN NONE;
} PERMISSIONS NONE;

-- Ends every pending two-factor challenge of identity $identity (its key): each row under `2fa-`
-- whose value is the identity, and the row counting its codes, the identifiers read before any
-- row goes. A change of what a challenge stood for (the account's password, its email, its second
-- factor, the account itself) calls it in its own transaction, so no code is taken for it after.
DEFINE FUNCTION OVERWRITE fn::two_factor_challenges_end($identity: string) {
  FOR $identifier IN (
    SELECT VALUE identifier
    FROM verification
    WHERE
      `value` = $identity
      AND string::starts_with(identifier, '2fa-')
  ) {
    fn::two_factor_challenge_end($identifier);
  };
} PERMISSIONS NONE;
