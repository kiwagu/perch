-- Public face of an account: name, contact email, biography and language. Replicated
-- into the owner's private region, so clients read and edit it offline. On the server
-- only the owner may read or update it; rows arrive through replication, never through
-- a direct CREATE or DELETE.

-- @region private
-- @id prf
DEFINE TABLE OVERWRITE profile SCHEMAFULL
  PERMISSIONS
    FOR select, update WHERE identity = $auth.id
    FOR create, delete NONE;

DEFINE FIELD OVERWRITE identity ON profile TYPE record<identity>;
DEFINE FIELD OVERWRITE name ON profile TYPE string
  ASSERT string::len($value) > 0;
DEFINE FIELD OVERWRITE email ON profile TYPE string;
-- @crdt text
DEFINE FIELD OVERWRITE bio ON profile TYPE option<string>;
DEFINE FIELD OVERWRITE locale ON profile TYPE option<string>
  ASSERT $value = NONE
  OR $value IN ['en', 'es'];
DEFINE FIELD OVERWRITE created_at ON profile TYPE datetime
  DEFAULT time::now()
  READONLY;

DEFINE INDEX OVERWRITE profile_identity ON profile FIELDS identity UNIQUE;
