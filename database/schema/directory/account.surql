-- How an identity signs in: Better Auth's account model. A credential row (`provider_id`
-- 'credential', `account_id` the identity's own key) holds the argon2id hash of the password;
-- a row of an external provider holds that provider's subject and tokens. Server-only, written
-- by the gateway as the namespace user; no record user reads it.

-- @replicate none
-- @id acc
DEFINE TABLE OVERWRITE account SCHEMAFULL
  PERMISSIONS
    FOR select, create, update, delete NONE;

-- The key of the identity, as Better Auth's adapter writes and compares a reference: a plain
-- string, not a record id.
DEFINE FIELD OVERWRITE identity ON account TYPE string;
DEFINE FIELD OVERWRITE account_id ON account TYPE string;
DEFINE FIELD OVERWRITE provider_id ON account TYPE string;
DEFINE FIELD OVERWRITE password ON account TYPE option<string>;
DEFINE FIELD OVERWRITE access_token ON account TYPE option<string>;
DEFINE FIELD OVERWRITE refresh_token ON account TYPE option<string>;
DEFINE FIELD OVERWRITE id_token ON account TYPE option<string>;
DEFINE FIELD OVERWRITE scope ON account TYPE option<string>;
DEFINE FIELD OVERWRITE access_token_expires_at ON account TYPE option<datetime>;
DEFINE FIELD OVERWRITE refresh_token_expires_at ON account TYPE option<datetime>;
DEFINE FIELD OVERWRITE created_at ON account TYPE datetime
  DEFAULT time::now()
  READONLY;
DEFINE FIELD OVERWRITE updated_at ON account TYPE datetime DEFAULT time::now();

DEFINE INDEX OVERWRITE account_provider_account ON account FIELDS provider_id, account_id
  UNIQUE;
DEFINE INDEX OVERWRITE account_identity ON account FIELDS identity;
