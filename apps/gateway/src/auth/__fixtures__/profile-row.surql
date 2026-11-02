-- The profile of identity $identity (its key), named $name with email $email, as replication would
-- store it in the directory.
CREATE profile SET
  identity = type::record('identity', $identity),
  name = $name,
  email = $email;
