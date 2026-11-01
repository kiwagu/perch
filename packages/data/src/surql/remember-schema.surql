-- Remembers the schema text just applied, so an opening with the same text leaves it alone.
DEFINE PARAM OVERWRITE $applied_schema VALUE $schema PERMISSIONS NONE;
