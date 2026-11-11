-- An account written directly, as a sign-up and later changes would leave it: identity $key with
-- email $email, sign-up name $name, made at $created_at, its email verified or not
-- ($email_verified), banned or not ($banned) with reason $ban_reason, and platform role $role.
CREATE type::record('identity', $key) SET
  email = $email,
  name = $name,
  created_at = $created_at,
  email_verified = $email_verified,
  banned = $banned,
  ban_reason = $ban_reason,
  role = $role
RETURN NONE;
