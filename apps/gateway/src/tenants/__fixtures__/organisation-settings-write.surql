-- The organisation's settings row $id with the fields $content, for a spec that reads it back.
UPSERT type::record('organisation_settings', $id) CONTENT $content RETURN NONE;
