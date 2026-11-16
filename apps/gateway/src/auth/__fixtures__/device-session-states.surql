-- Every session row of identity $identity (its key), the earliest first: its device and token,
-- whether it waits for its admission, and when and why it ended (absent while it has not).
SELECT
  device,
  token,
  pending,
  ended_at,
  ended_reason,
  created_at
FROM device_session
WHERE identity = $identity
ORDER BY created_at;
