-- Accounts and sign-in. Server-only: the table holds password hashes, so it never
-- leaves the server and is not replicated to clients. A signed-in user can read and
-- rename only their own record; accounts are created only through the access method
-- below, never by a direct CREATE.

-- @replicate none
-- @id usr
DEFINE TABLE OVERWRITE user SCHEMAFULL
  PERMISSIONS
    FOR select, update WHERE id = $auth.id
    FOR create, delete NONE;

DEFINE FIELD OVERWRITE email ON user TYPE string ASSERT string::is_email($value);
DEFINE FIELD OVERWRITE name ON user TYPE string ASSERT string::len($value) > 0;
DEFINE FIELD OVERWRITE password ON user TYPE string
  PERMISSIONS
    FOR select NONE;
DEFINE FIELD OVERWRITE created_at ON user TYPE datetime
  DEFAULT time::now()
  READONLY;

DEFINE INDEX OVERWRITE user_email ON user FIELDS email UNIQUE;

-- Sign-up creates only the account. The replicated profile is written afterwards by
-- the client through its own command, because profile rows live in the user's
-- private region and are authored there.
DEFINE ACCESS OVERWRITE user ON DATABASE TYPE RECORD
  SIGNUP (
    CREATE user SET
      email = $email,
      name = $name,
      password = crypto::argon2::generate($password)
  )
  SIGNIN (
    SELECT *
    FROM user
    WHERE
      email = $email
      AND crypto::argon2::compare(password, $password)
  ) DURATION FOR TOKEN 15m, FOR SESSION 12h;
