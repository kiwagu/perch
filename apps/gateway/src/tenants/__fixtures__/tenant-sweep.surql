-- Removes the organisation with key $key as the seed's sweep does: its memberships, its
-- database $database, then its directory row.
DELETE membership WHERE tenant.key = $key;
REMOVE DATABASE IF EXISTS $database;
DELETE tenant WHERE key = $key;
