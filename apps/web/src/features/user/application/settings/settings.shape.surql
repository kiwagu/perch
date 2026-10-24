-- The signed-in account's settings from the private region: the language the app applies
-- on each of its devices, stored here when it is chosen.
-- @params $identity: record<identity>
SELECT id, locale FROM settings WHERE identity = $identity LIMIT 1;
