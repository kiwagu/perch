-- A second-factor row written before its failure counter existed: the column was never set.
CREATE $id SET
  secret = $secret,
  backup_codes = $codes,
  identity = $owner;
