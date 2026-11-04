-- The signed-in account's settings from the private region: the language and the theme the app
-- applies in each of its tabs and on each of its devices, stored here when they are chosen.
-- @params $identity: record<identity>
SELECT
  id,
  locale,
  theme
FROM settings
WHERE identity = $identity
LIMIT 1;
