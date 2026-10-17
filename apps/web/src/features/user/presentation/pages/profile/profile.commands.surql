-- Profile changes. On the client each command becomes operations on the identity's
-- private region; the statements declare what a command may touch.

-- @command createProfile($id: record<profile>, $identity: record<identity>, $name: string, $email: string)
-- @allow record
CREATE $id SET
  identity = $identity,
  name = $name,
  email = $email;

-- @command updateName($id: record<profile>, $name: string)
-- @allow record
UPDATE $id SET name = $name;

-- @command updateBio($id: record<profile>, $bio: string)
-- @allow record
UPDATE $id SET bio = $bio;

-- @command updateLocale($id: record<profile>, $locale: 'en' | 'es')
-- @allow record
UPDATE $id SET locale = $locale;
