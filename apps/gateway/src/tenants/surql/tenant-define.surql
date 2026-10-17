-- The organisation's database, strict: nothing is used in it before it is defined. The name
-- comes from the caller, checked against the key pattern before it gets here.
DEFINE DATABASE IF NOT EXISTS $database STRICT;
