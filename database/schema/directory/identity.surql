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
-- The account's role on the platform, the one role Better Auth's admin plugin keeps: `operator`
-- runs the platform's console of accounts; `user`, which the plugin writes when it creates an
-- account, is no platform role, and neither is NONE, a row written another way. One name, never a
-- list: nothing else is a platform role, and the plugin's own `admin` is not used.
DEFINE FIELD OVERWRITE role ON identity TYPE option<string>
  ASSERT $value = NONE
  OR $value IN ['user', 'operator'];
-- Whether an operator banned the account: a banned account is handed no session and every session
-- it had ends with the ban, until an operator lifts it. False for every account until then.
DEFINE FIELD OVERWRITE banned ON identity TYPE bool DEFAULT false;
-- Why the account was banned, as the operator wrote it, for operators alone: never in an answer
-- to the account. NONE when no reason was given or the account is not banned.
DEFINE FIELD OVERWRITE ban_reason ON identity TYPE option<string>;
-- When a ban would lift by itself, as the admin plugin keeps it: the plugin lifts an expired ban at
-- the account's next sign-in. The gateway sets none, so a ban lasts until an operator lifts it.
DEFINE FIELD OVERWRITE ban_expires ON identity TYPE option<datetime>;

DEFINE INDEX OVERWRITE identity_email ON identity FIELDS email UNIQUE;
