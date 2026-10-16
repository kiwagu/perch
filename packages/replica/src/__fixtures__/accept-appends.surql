-- Restores the update log's field as the schema defines it.
DEFINE FIELD OVERWRITE seq ON _replica_update TYPE int;
