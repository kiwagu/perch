-- Every session row of the devices of identity $identity (its key), the earliest first, rows
-- created at the same instant by id.
SELECT * FROM device_session WHERE identity = $identity ORDER BY created_at, id;
