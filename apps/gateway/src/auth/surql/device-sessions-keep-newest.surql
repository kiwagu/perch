-- Keeps the newest session of identity $identity (its key) on device $device, the one created
-- last, of the greater id among those created at the same instant, and ends at $ended_at every
-- other one that was not ended already (an expired one at its expiry). Every sign-in runs it once
-- its row exists, so the device converges on its newest session whatever order the rows are
-- inserted and the statements run in: a sign-in whose row comes after a newer one ends its own.
-- The newest is chosen inside the update, so it and the rows ended come from one view of the
-- table.
UPDATE device_session SET
  ended_at = ended_at ?? time::min([expires_at, $ended_at]),
  expires_at = time::min([expires_at, $ended_at])
WHERE
  identity = $identity
  AND device = $device
  AND ended_at = NONE
  AND id != (
    SELECT VALUE id
    FROM device_session
    WHERE
      identity = $identity
      AND device = $device
    ORDER BY created_at DESC, id DESC
    LIMIT 1
  )[0]
RETURN NONE;
