DEFINE TABLE OVERWRITE __entity SCHEMAFULL PERMISSIONS NONE;

DEFINE FIELD OVERWRITE ns ON __entity TYPE string;

DEFINE FIELD OVERWRITE key ON __entity TYPE string;

DEFINE FIELD OVERWRITE val ON __entity TYPE any;

DEFINE FIELD OVERWRITE updated_at ON __entity TYPE datetime DEFAULT time::now();

DEFINE INDEX OVERWRITE by_ns_key ON __entity FIELDS ns, key UNIQUE;

DEFINE TABLE OVERWRITE __rollout SCHEMAFULL PERMISSIONS NONE;

DEFINE FIELD OVERWRITE id ON __rollout TYPE string;

DEFINE FIELD OVERWRITE name ON __rollout TYPE string;

DEFINE FIELD OVERWRITE manifest_path ON __rollout TYPE string;

DEFINE FIELD OVERWRITE manifest_checksum ON __rollout TYPE string;

DEFINE FIELD OVERWRITE source_schema_hash ON __rollout TYPE string;

DEFINE FIELD OVERWRITE target_schema_hash ON __rollout TYPE string;

DEFINE FIELD OVERWRITE status ON __rollout TYPE string;

DEFINE FIELD OVERWRITE source_entities ON __rollout TYPE any;

DEFINE FIELD OVERWRITE target_entities ON __rollout TYPE any;

DEFINE FIELD OVERWRITE steps ON __rollout TYPE any DEFAULT [];

DEFINE FIELD OVERWRITE started_at ON __rollout TYPE datetime DEFAULT time::now();

DEFINE FIELD OVERWRITE completed_at ON __rollout TYPE option<datetime>;

DEFINE FIELD OVERWRITE updated_at ON __rollout TYPE datetime DEFAULT time::now();

DEFINE FIELD OVERWRITE last_error ON __rollout TYPE option<string>;

DEFINE INDEX OVERWRITE by_rollout_id ON __rollout FIELDS id UNIQUE;

DEFINE TABLE OVERWRITE __seed SCHEMAFULL PERMISSIONS NONE;

DEFINE FIELD OVERWRITE key ON __seed TYPE string;

DEFINE FIELD OVERWRITE hash ON __seed TYPE string;

DEFINE FIELD OVERWRITE applied_at ON __seed TYPE datetime DEFAULT time::now();

DEFINE INDEX OVERWRITE by_seed_key ON __seed FIELDS key UNIQUE;

-- For SurrealKit's test databases only: the suites' record actors sign up and in through this
-- access method, which creates the identity row and its credential row as the product does.
-- The product's accounts are signed in by the gateway, which never defines this method.
DEFINE ACCESS OVERWRITE identity ON DATABASE TYPE RECORD
  SIGNUP {
    LET $identity = (
      CREATE ONLY type::record('identity', fn::entity_id('idn')) SET
        email = $email,
        email_verified = true,
        name = $email
    );
    CREATE type::record('account', fn::entity_id('acc')) SET
      identity = record::id($identity.id),
      account_id = record::id($identity.id),
      provider_id = 'credential',
      password = crypto::argon2::generate($password);
    RETURN $identity;
  }
  SIGNIN (
    SELECT *
    FROM ONLY identity
    WHERE
      email = string::lowercase($email)
      AND count(
        SELECT id
        FROM account
        WHERE
          provider_id = 'credential'
          AND identity = record::id($parent.id)
          AND crypto::argon2::compare(password, $password)
      ) > 0
    LIMIT 1
  ) DURATION FOR TOKEN 15m, FOR SESSION 12h;
