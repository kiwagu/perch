-- A session row of identity $identity (its key) on device $device under key $key, which may be
-- one the gateway never mints, holding token $session_token, created at $created_at and live for
-- a day.
CREATE type::record('device_session', $key) SET
  identity = $identity,
  token = $session_token,
  device = $device,
  label = '',
  created_at = $created_at,
  expires_at = time::now() + 1d;
