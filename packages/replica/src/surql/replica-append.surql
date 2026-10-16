BEGIN TRANSACTION;
  CREATE _replica_update SET
    region = $region,
    seq = $seq,
    bytes = $bytes;
  CREATE _replica_outbox SET
    region = $region,
    seq = $seq,
    bytes = $bytes;
COMMIT TRANSACTION;
