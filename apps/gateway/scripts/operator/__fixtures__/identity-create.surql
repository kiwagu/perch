-- An identity row of key $key and email $email, written directly with every field that is not the
-- role set to something other than its default: a verified, banned account with an image.
CREATE type::record('identity', $key) SET
  email = $email,
  name = 'Ann Example',
  email_verified = true,
  locale = 'es',
  image = 'https://example.test/ann.png',
  banned = true,
  ban_reason = 'spam';
