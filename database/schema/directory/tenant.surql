-- An organisation as the directory knows it: its key names its database (`t_<key>`) and its
-- region (`tenant:<key>`). Written by the gateway only; a record user never reads it directly,
-- memberships are what a device learns about its organisations.

-- @replicate none
-- @id tnt
DEFINE TABLE OVERWRITE tenant SCHEMAFULL PERMISSIONS NONE;

DEFINE FIELD OVERWRITE key ON tenant TYPE string
  ASSERT string::matches($value, '^[a-z][a-z0-9_]{1,31}$');
DEFINE FIELD OVERWRITE name ON tenant TYPE string
  ASSERT string::len($value) > 0
  AND string::len($value) <= 80;
DEFINE FIELD OVERWRITE namespace ON tenant TYPE string DEFAULT 'app';
DEFINE FIELD OVERWRITE database ON tenant TYPE string;
-- `provisioning` until the organisation's database holds its schema and its first member.
DEFINE FIELD OVERWRITE status ON tenant TYPE string
  ASSERT $value IN ['provisioning', 'ready'];
DEFINE FIELD OVERWRITE created_by ON tenant TYPE record<identity>;
DEFINE FIELD OVERWRITE created_at ON tenant TYPE datetime
  DEFAULT time::now()
  READONLY;

DEFINE INDEX OVERWRITE tenant_key ON tenant FIELDS key UNIQUE;
