-- A member of this organisation, keyed by the identity id (`member:<identity key>`): the
-- organisation database's own word on who belongs and with which role. Written by the
-- gateway only; never replicated (devices learn their memberships from the gateway).

-- @replicate none
DEFINE TABLE OVERWRITE member SCHEMAFULL PERMISSIONS NONE;

DEFINE FIELD OVERWRITE role ON member TYPE string
  ASSERT $value IN ['member', 'admin'];
DEFINE FIELD OVERWRITE created_at ON member TYPE datetime
  DEFAULT time::now()
  READONLY;
