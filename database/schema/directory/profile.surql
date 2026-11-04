-- Public face of an account: name, contact email and biography. Replicated
-- into the owner's private region, so clients read and edit it offline. On the server
-- only the owner may read it, and nobody writes it directly: rows arrive only through
-- replication, which the gateway checks before it stores them. The identity, the email and the
-- creation time are set when the profile is created and never changed by a device: the email
-- changes only through the gateway's confirmation flow.

-- @region private
-- @id prf
DEFINE TABLE OVERWRITE profile SCHEMAFULL
  PERMISSIONS
    FOR select WHERE identity = $auth.id
    FOR create, update, delete NONE;

-- @readonly
DEFINE FIELD OVERWRITE identity ON profile TYPE record<identity>;
DEFINE FIELD OVERWRITE name ON profile TYPE string
  ASSERT string::len($value) > 0;
-- @readonly
DEFINE FIELD OVERWRITE email ON profile TYPE string;
-- @crdt text
DEFINE FIELD OVERWRITE bio ON profile TYPE option<string>
  ASSERT $value = NONE
  OR string::len($value) <= 2000;
-- @readonly
DEFINE FIELD OVERWRITE created_at ON profile TYPE datetime
  DEFAULT time::now()
  READONLY;

DEFINE INDEX OVERWRITE profile_identity ON profile FIELDS identity UNIQUE;
