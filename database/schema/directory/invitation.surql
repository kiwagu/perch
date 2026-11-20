-- Pending invitations of an email to an organisation: the role its account takes on accepting,
-- who invited it, the token its link carries and when it expires. Written by the gateway only,
-- closed to every record user. One per organisation and email: a newer invitation of the email
-- replaces the older one, whose link then names nothing.

-- @replicate none
-- @id inv
DEFINE TABLE OVERWRITE invitation SCHEMAFULL PERMISSIONS NONE;

DEFINE FIELD OVERWRITE tenant ON invitation TYPE record<tenant>;
DEFINE FIELD OVERWRITE email ON invitation TYPE string
  VALUE string::lowercase($value)
  ASSERT string::is_email($value);
DEFINE FIELD OVERWRITE role ON invitation TYPE string
  ASSERT $value IN ['member', 'admin'];
DEFINE FIELD OVERWRITE inviter ON invitation TYPE record<identity>;
DEFINE FIELD OVERWRITE token ON invitation TYPE string;
DEFINE FIELD OVERWRITE expires_at ON invitation TYPE datetime;
DEFINE FIELD OVERWRITE created_at ON invitation TYPE datetime
  DEFAULT time::now()
  READONLY;

DEFINE INDEX OVERWRITE invitation_tenant_email ON invitation FIELDS tenant, email
  UNIQUE;
DEFINE INDEX OVERWRITE invitation_email ON invitation FIELDS email;
