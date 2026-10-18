-- Accounts and sign-in. Server-only: the table holds password hashes, so it never
-- leaves the server and is not replicated to clients. A signed-in identity reads
-- only its own record; identities are created only through the access method
-- below. The name people see lives in the replicated profile, not here.

-- @replicate none
-- @id idn
DEFINE TABLE OVERWRITE identity SCHEMAFULL
  PERMISSIONS
    FOR select WHERE id = $auth.id
    FOR create, update, delete NONE;

DEFINE FIELD OVERWRITE email ON identity TYPE string ASSERT string::is_email($value);
DEFINE FIELD OVERWRITE password ON identity TYPE string
  PERMISSIONS
    FOR select NONE;
-- Tokens issued before this moment are refused by the access method below (a sign-out
-- everywhere). Only the gateway writes it, as the namespace user.
DEFINE FIELD OVERWRITE sessions_revoked_at ON identity TYPE option<datetime>
  PERMISSIONS
    FOR select NONE;
DEFINE FIELD OVERWRITE created_at ON identity TYPE datetime
  DEFAULT time::now()
  READONLY;

DEFINE INDEX OVERWRITE identity_email ON identity FIELDS email UNIQUE;

-- Access tokens are short-lived; the refresh key that comes with them renews the
-- session for up to 30 days, is replaced on every use and can be revoked. A token issued
-- before the identity's `sessions_revoked_at` is refused; a refresh exchange carries no token,
-- so the clause does not block it: only revoking the identity's grants does.
DEFINE ACCESS OVERWRITE identity ON DATABASE TYPE RECORD
  SIGNUP (
    CREATE type::record('identity', fn::entity_id('idn')) SET
      email = $email,
      password = crypto::argon2::generate($password)
  )
  SIGNIN (
    SELECT *
    FROM identity
    WHERE
      email = $email
      AND crypto::argon2::compare(password, $password)
  )
  WITH REFRESH
  AUTHENTICATE {
    IF $token.iat != NONE
      AND $auth.sessions_revoked_at != NONE
      AND $auth.sessions_revoked_at > time::from_unix($token.iat)
    THEN THROW "signed out everywhere" END;
    RETURN $auth;
  }
  DURATION FOR GRANT 30d, FOR TOKEN 15m, FOR SESSION 12h;
