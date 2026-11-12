-- Organisation $tenant goes whole, in one transaction: its database $database, every
-- membership and every invitation of it, then its directory row. Nothing changes for an
-- organisation already gone.
BEGIN TRANSACTION;
  REMOVE DATABASE IF EXISTS $database;
  DELETE membership WHERE tenant = $tenant RETURN NONE;
  DELETE invitation WHERE tenant = $tenant RETURN NONE;
  DELETE $tenant RETURN NONE;
COMMIT TRANSACTION;
