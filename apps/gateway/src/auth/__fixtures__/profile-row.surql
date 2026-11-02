-- The profile $id of identity $identity (its key), named $name with email $email, as replication
-- would store it in the directory.
CREATE type::record('profile', $id) SET
  identity = type::record('identity', $identity),
  name = $name,
  email = $email;
