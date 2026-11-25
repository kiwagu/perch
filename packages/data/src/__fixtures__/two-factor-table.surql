-- A table for Better Auth's second-factor model, under the names the directory's other auth
-- tables use: snake_case columns, the owner's key as a plain string.
DEFINE TABLE OVERWRITE two_factor SCHEMAFULL
  PERMISSIONS
    FOR select, create, update, delete NONE;

DEFINE FIELD OVERWRITE secret ON two_factor TYPE string;
DEFINE FIELD OVERWRITE backup_codes ON two_factor TYPE string;
DEFINE FIELD OVERWRITE identity ON two_factor TYPE string;
DEFINE FIELD OVERWRITE verified ON two_factor TYPE option<bool | null>;
DEFINE FIELD OVERWRITE failed_verification_count ON two_factor TYPE option<int | null>;
DEFINE FIELD OVERWRITE locked_until ON two_factor TYPE option<datetime | null>;
