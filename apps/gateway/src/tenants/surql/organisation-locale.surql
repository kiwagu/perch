-- The default language of the organisation's settings row $id (`ost_<key>`): NONE when it has
-- none, or when the row is not there yet.
SELECT VALUE locale FROM ONLY type::record('organisation_settings', $id);
