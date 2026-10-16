-- Remembers the schema text just applied. Applying an unchanged schema again would
-- redefine the access method with a new signing key and end every saved session.
DEFINE PARAM OVERWRITE $applied_schema VALUE $schema PERMISSIONS NONE;
