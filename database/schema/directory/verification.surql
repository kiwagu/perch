-- One-time tokens with an expiry: Better Auth's verification model (email verification, password
-- reset, email change, deletion, a sign-in's two-factor challenge and the count of its codes, a
-- passkey's registration or sign-in challenge), each a value kept under an identifier until it is
-- spent or expires. Server-only, written by the gateway as the namespace user.

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

-- The kind of ceremony a row belongs to, which the gateway reclaims once it expired, as nothing
-- else deletes it (Better Auth's own clean-up of expired rows is off): `passkey` for the options of
-- a passkey's registration or sign-in (their JSON value opens with `{"type":"registration",` or
-- `{"type":"authentication",`), `two-factor` for a password step's challenge (`2fa-<random>`) and
-- the row counting its codes (`2fa-attempts-2fa-<random>`). None for every other row (a reset
-- link, a pending change of an email or deletion of an account), which is never reclaimed, so it
-- still reads as expired. The database derives it at each write from the row's identifier and
-- value; Better Auth neither writes nor reads it.
DEFINE FIELD OVERWRITE ceremony ON verification TYPE option<string>
  VALUE IF string::starts_with(identifier, '2fa-') {
    'two-factor'
  } ELSE IF string::starts_with(`value`, '{"type":"registration",')
    OR string::starts_with(`value`, '{"type":"authentication",') {
    'passkey'
  } ELSE {
    NONE
  };

DEFINE INDEX OVERWRITE verification_identifier ON verification FIELDS identifier;
-- The ceremonies of one kind by their expiry, the earliest first: a reclaim reads the expired ones
-- of its kind through it, so it reads the rows it reclaims and no other.
DEFINE INDEX OVERWRITE verification_ceremony_expiry ON verification FIELDS ceremony, expires_at;
