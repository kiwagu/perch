-- A table whose unique index holds the key 1: a second row with it is refused.
DEFINE TABLE probe SCHEMALESS;
DEFINE INDEX probe_key ON probe FIELDS key UNIQUE;
CREATE probe SET key = 1;
