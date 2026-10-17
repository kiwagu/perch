-- A namespace user that owns the namespace, as a server stand's gateway connects.
DEFINE USER OVERWRITE gateway ON NAMESPACE PASSWORD 'gateway-pass' ROLES OWNER;
