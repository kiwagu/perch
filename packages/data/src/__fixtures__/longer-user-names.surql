-- A later schema version: account names need at least four characters.
DEFINE FIELD OVERWRITE name ON user TYPE string ASSERT string::len($value) > 3;
