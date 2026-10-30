-- Which identities belong to which organisation, with their role there. Written by the
-- gateway; an identity reads only its own rows.

-- @replicate none
-- @id mbr
DEFINE TABLE OVERWRITE membership SCHEMAFULL
  PERMISSIONS
    FOR select WHERE identity = $auth.id
    FOR create, update, delete NONE;

DEFINE FIELD OVERWRITE identity ON membership TYPE record<identity>;
DEFINE FIELD OVERWRITE tenant ON membership TYPE record<tenant>;
DEFINE FIELD OVERWRITE role ON membership TYPE string
  ASSERT $value IN ['member', 'admin'];
DEFINE FIELD OVERWRITE created_at ON membership TYPE datetime
  DEFAULT time::now()
  READONLY;

DEFINE INDEX OVERWRITE membership_identity_tenant ON membership FIELDS identity, tenant
  UNIQUE;
