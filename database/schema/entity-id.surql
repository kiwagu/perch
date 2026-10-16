-- Record keys in the workspace id format: `<prefix>_<16 random chars>.<10 time chars>`,
-- both parts taken from one ULID and lowercased, so keys say what they identify and
-- sort by creation time. Clients mint the same format themselves; this function is
-- for records the server creates, such as accounts made by the access method.

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
