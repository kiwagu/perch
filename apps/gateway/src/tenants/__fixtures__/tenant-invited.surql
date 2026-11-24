-- An organisation $key in status $status that invited $email, its invitation made at $created and
-- expiring at $expires, for a spec of the language an invited account starts in.
LET $tenant = (
  UPSERT ONLY type::record('tenant', $key) SET
    key = $key,
    name = $key,
    database = $key,
    status = $status,
    created_by = type::record('identity', 'idn_spec')
);
CREATE invitation SET
  tenant = $tenant.id,
  email = $email,
  role = 'member',
  inviter = type::record('identity', 'idn_spec'),
  token = rand::string(16),
  expires_at = $expires,
  created_at = $created;
