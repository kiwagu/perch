-- What an operator sets up once on a stand: the platform namespace, the directory
-- database and the gateway's account. The gateway owns the namespace and needs no
-- root account; root stays with the operators. SurrealDB takes a user's password only
-- as a literal, so this one is the local in-memory stands' own; a real deployment
-- defines the gateway's user by hand with a password of its own.
DEFINE NAMESPACE IF NOT EXISTS app;
USE NS app;
DEFINE DATABASE IF NOT EXISTS directory;
DEFINE USER OVERWRITE gateway ON NAMESPACE PASSWORD 'gateway-stand-password' ROLES OWNER;
