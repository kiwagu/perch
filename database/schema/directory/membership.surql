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

-- The members list, the admins' count and the invite's email check read the memberships of one
-- organisation. The unique index above leads with the identity, so it cannot serve them: without
-- this one each is a scan of every membership of every organisation.
DEFINE INDEX OVERWRITE membership_tenant ON membership FIELDS tenant;
