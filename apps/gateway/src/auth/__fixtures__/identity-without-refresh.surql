-- The identity access method without refresh grants: a sign-up or sign-in answers
-- with an access token only.
DEFINE ACCESS OVERWRITE identity ON DATABASE TYPE RECORD
  SIGNUP (
    CREATE type::record('identity', fn::entity_id('idn')) SET
      email = $email,
      password = crypto::argon2::generate($password)
  )
  SIGNIN (
    SELECT *
    FROM identity
    WHERE
      email = $email
      AND crypto::argon2::compare(password, $password)
  ) DURATION FOR TOKEN 15m, FOR SESSION 12h;
