-- A session row $key of identity $identity (its key) on device $device, holding token
-- $session_token: last seen at $last_seen_at, live until $expires_at or ended at $ended_at, and
-- waiting for its admission or not ($pending).
CREATE type::record('device_session', $key) SET
  identity = $identity,
  token = $session_token,
  device = $device,
  label = '',
  last_seen_at = $last_seen_at,
  expires_at = $expires_at,
  ended_at = $ended_at,
  pending = $pending
RETURN NONE;
