-- Every session row of identity $identity (its key): its device, whether it waits for its
-- admission, when it ends or ended, and when and why it ended (absent while it has not).
SELECT
  device,
  pending,
  expires_at,
  ended_at,
  ended_reason
FROM device_session
WHERE identity = $identity;
