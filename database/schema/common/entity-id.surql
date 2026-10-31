-- Record keys in the workspace id format: `<prefix>_<16 random chars>.<10 time chars>`,
-- both parts taken from one ULID and lowercased, so keys say what they identify and
-- sort by creation time. Clients and the gateway mint the same format themselves; this
-- function is for records SurrealQL creates, such as the accounts the suites' test-only
-- access method makes (`database/setup.surql`).

DEFINE FUNCTION OVERWRITE fn::entity_id($prefix: string) {
  LET $ulid = string::lowercase(rand::ulid());
  RETURN string::concat(
    $prefix,
    '_',
    string::slice($ulid, 10),
    '.',
    string::slice($ulid, 0, 10)
  );
};
