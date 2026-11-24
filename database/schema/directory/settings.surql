-- The settings of an account: what the app is like for it, today its language and its theme. One
-- row per account, created at sign-up next to the profile. Replicated into the owner's private
-- region, so every device of the account reads and changes it offline. On the server only
-- the owner may read it, and nobody writes it directly: rows arrive only through
-- replication, which the gateway checks before it stores them.

-- @region private
-- @id stg
DEFINE TABLE OVERWRITE settings SCHEMAFULL
  PERMISSIONS
    FOR select WHERE identity = $auth.id
    FOR create, update, delete NONE;

-- @readonly
DEFINE FIELD OVERWRITE identity ON settings TYPE record<identity>;
DEFINE FIELD OVERWRITE locale ON settings TYPE string
  ASSERT $value IN ['en', 'es'];
-- Light, dark, or the device's own setting, which each device follows as it changes.
DEFINE FIELD OVERWRITE theme ON settings TYPE string
  ASSERT $value IN ['light', 'dark', 'system'];

DEFINE INDEX OVERWRITE settings_identity ON settings FIELDS identity UNIQUE;
