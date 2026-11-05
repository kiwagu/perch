-- The email, the name and the language of the sign-up of identity $identity (its key), as a
-- mail to the account needs them, or NONE when the identity is gone.
SELECT
  email,
  name,
  locale
FROM ONLY type::record('identity', $identity);
