-- Settings changes. On the client each command becomes operations on the identity's
-- private region; the statements declare what a command may touch.

-- @command createSettings($id: record<settings>, $identity: record<identity>, $locale: 'en' | 'es')
-- @allow record
CREATE $id SET identity = $identity, locale = $locale;

-- @command updateLocale($id: record<settings>, $locale: 'en' | 'es')
-- @allow record
UPDATE $id SET locale = $locale;
