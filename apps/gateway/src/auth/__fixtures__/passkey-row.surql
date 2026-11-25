-- A passkey of identity $identity (its key) under record key $key, as Better Auth's passkey
-- plugin writes one once a registration passed: its credential, public key and counter.
CREATE type::record('passkey', $key) SET
  identity = $identity,
  name = NONE,
  public_key = 'cHVibGljLWtleQ',
  credential_id = string::concat('credential-', $key),
  counter = 0,
  device_type = 'singleDevice',
  backed_up = false,
  transports = 'internal',
  created_at = time::now()
RETURN NONE;
