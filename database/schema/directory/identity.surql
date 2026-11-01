-- Accounts. Server-only: the table is Better Auth's user model, written only by the gateway as
-- the namespace user; it never leaves the server and is not replicated to clients. A signed-in
-- identity reads only its own record (the second line for a later JWT access; today no record
-- user reaches the server). The password hash lives on the credential row of `account`. The
-- name people see lives in the replicated profile; `name` here is the account's own, taken at
-- sign-up and never shown. An email is kept and matched in lower case: an address in any case is
-- one account. `locale` is the language the account signed up in: its mails speak it until its
-- settings name one; `en` when nothing named one.

-- @replicate none
-- @id idn
DEFINE TABLE OVERWRITE identity SCHEMAFULL
  PERMISSIONS
    FOR select WHERE id = $auth.id
    FOR create, update, delete NONE;

DEFINE FIELD OVERWRITE email ON identity TYPE string
  VALUE string::lowercase($value)
  ASSERT string::is_email($value);
DEFINE FIELD OVERWRITE email_verified ON identity TYPE bool DEFAULT false;
DEFINE FIELD OVERWRITE name ON identity TYPE string;
DEFINE FIELD OVERWRITE image ON identity TYPE option<string>;
DEFINE FIELD OVERWRITE locale ON identity TYPE string
  DEFAULT 'en'
  ASSERT $value IN ['en', 'es'];
DEFINE FIELD OVERWRITE created_at ON identity TYPE datetime
  DEFAULT time::now()
  READONLY;
DEFINE FIELD OVERWRITE updated_at ON identity TYPE datetime DEFAULT time::now();

DEFINE INDEX OVERWRITE identity_email ON identity FIELDS email UNIQUE;
