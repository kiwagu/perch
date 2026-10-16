-- A later schema version: account emails need more than twenty characters.
DEFINE FIELD OVERWRITE email ON identity TYPE string
  ASSERT string::is_email($value)
  AND string::len($value) > 20;
