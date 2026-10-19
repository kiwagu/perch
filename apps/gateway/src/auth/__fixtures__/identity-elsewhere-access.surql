-- A second record access method on the same database, for a token the identity access
-- method never issued. It signs with the key the schema is applied with, so a test that knows
-- that key can sign a token of its own for it.
DEFINE ACCESS OVERWRITE elsewhere ON DATABASE TYPE RECORD
  SIGNUP (
    CREATE type::record('identity', fn::entity_id('idn')) SET
      email = $email,
      password = crypto::argon2::generate($password)
  )
  WITH JWT ALGORITHM HS512 KEY $jwt_key
  DURATION FOR TOKEN 15m;
