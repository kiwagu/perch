-- The organisation's settings. Each command becomes operations on the tenant region of the
-- organisation it is sent to; only an admin may run them, which the gateway checks again.

-- @command createOrganisationSettings($id: record<organisation_settings>)
-- @allow record
CREATE $id SET locale = NONE;

-- @command updateLocale($id: record<organisation_settings>, $locale: 'en' | 'es')
-- @allow record
UPDATE $id SET locale = $locale;

-- @command clearLocale($id: record<organisation_settings>)
-- @allow record
UPDATE $id SET locale = NONE;
