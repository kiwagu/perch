-- The organisation's settings from its tenant region: its one row, under the id derived from its
-- key, with the default language an account its invitation creates starts in, or none.
-- @params $id: record<organisation_settings>
SELECT id, locale FROM organisation_settings WHERE id = $id LIMIT 1;
