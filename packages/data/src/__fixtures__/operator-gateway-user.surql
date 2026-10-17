-- What an operator sets up once on a stand: a namespace, its database and a namespace
-- user that owns it. SurrealDB takes a user's password only as a literal.
DEFINE NAMESPACE IF NOT EXISTS app;
USE NS app;
DEFINE DATABASE IF NOT EXISTS directory;
DEFINE USER OVERWRITE gateway ON NAMESPACE PASSWORD 'operator-test-password' ROLES OWNER;
