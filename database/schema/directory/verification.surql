-- One-time tokens with an expiry: Better Auth's verification model (email verification, password
-- reset, email change, deletion), each a value kept under an identifier until it is spent or
-- expires. Server-only, written by the gateway as the namespace user.

-- @replicate none
-- @id vrf
DEFINE TABLE OVERWRITE verification SCHEMAFULL
  PERMISSIONS
    FOR select, create, update, delete NONE;

DEFINE FIELD OVERWRITE identifier ON verification TYPE string;
DEFINE FIELD OVERWRITE value ON verification TYPE string;
DEFINE FIELD OVERWRITE expires_at ON verification TYPE datetime;
DEFINE FIELD OVERWRITE created_at ON verification TYPE datetime
  DEFAULT time::now()
  READONLY;
DEFINE FIELD OVERWRITE updated_at ON verification TYPE datetime
  DEFAULT time::now();

DEFINE INDEX OVERWRITE verification_identifier ON verification FIELDS identifier;
