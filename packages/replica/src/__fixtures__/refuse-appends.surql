-- Makes every append to the update log fail, as a full disk or a broken database would.
DEFINE FIELD OVERWRITE seq ON _replica_update TYPE int ASSERT $value < 0;
