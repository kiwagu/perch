-- Remembers the schema just applied: its text, and with a fixed signing key a digest of that
-- key. Applying an unchanged schema again without its key would redefine the access method
-- with a new signing key and end every saved session.
DEFINE PARAM OVERWRITE $applied_schema VALUE $schema PERMISSIONS NONE;
