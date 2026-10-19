-- A second record access method on the same database, for a token the identity access
-- method never issued.
DEFINE ACCESS OVERWRITE elsewhere ON DATABASE TYPE RECORD
  SIGNUP (
    CREATE type::record('identity', fn::entity_id('idn')) SET
      email = $email,
      password = crypto::argon2::generate($password)
  ) DURATION FOR TOKEN 15m;
