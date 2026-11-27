-- The passkeys of an account: Better Auth's passkey model, one row per credential an
-- authenticator made for the account, added while signed in and verified by the authenticator's
-- own check of its user. A passkey signs its account in with no password and no code. Server-only,
-- written by the gateway as the namespace user; nobody reads it directly.

-- @replicate none
-- @id pkey
DEFINE TABLE OVERWRITE passkey SCHEMAFULL
  PERMISSIONS
    FOR select, create, update, delete NONE;

-- The key of the identity, as Better Auth's adapter writes and compares a reference: a plain
-- string, not a record id.
DEFINE FIELD OVERWRITE identity ON passkey TYPE string;
-- A name for the passkey, when one was given.
DEFINE FIELD OVERWRITE name ON passkey TYPE option<string>;
-- The credential's public key, base64, which checks each sign-in's signature.
DEFINE FIELD OVERWRITE public_key ON passkey TYPE string;
-- The credential's id, as the authenticator names it in each sign-in.
DEFINE FIELD OVERWRITE credential_id ON passkey TYPE string;
-- The authenticator's count of its signatures, as the last sign-in left it.
DEFINE FIELD OVERWRITE counter ON passkey TYPE int;
-- Whether the credential lives on one device (`singleDevice`) or is synced (`multiDevice`).
DEFINE FIELD OVERWRITE device_type ON passkey TYPE string;
-- Whether the credential is backed up by its provider.
DEFINE FIELD OVERWRITE backed_up ON passkey TYPE bool;
-- How the browser reaches the authenticator, a comma-separated list.
DEFINE FIELD OVERWRITE transports ON passkey TYPE option<string>;
DEFINE FIELD OVERWRITE created_at ON passkey TYPE datetime
  DEFAULT time::now()
  READONLY;
-- The authenticator's model, as it names itself at the registration.
DEFINE FIELD OVERWRITE aaguid ON passkey TYPE option<string>;

DEFINE INDEX OVERWRITE passkey_identity ON passkey FIELDS identity;
DEFINE INDEX OVERWRITE passkey_credential ON passkey FIELDS credential_id UNIQUE;
