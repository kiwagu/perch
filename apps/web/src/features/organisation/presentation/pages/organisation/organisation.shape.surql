-- The organisation page reads the notes of the current organisation from its tenant region,
-- oldest first.
-- @tables note
SELECT
  id,
  author,
  text,
  created_at
FROM note
ORDER BY created_at;
