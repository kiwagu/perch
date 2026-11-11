-- Gives identity $identity the platform role $role and the ban reason $reason, written directly.
UPDATE type::record('identity', $identity) SET
  role = $role,
  ban_reason = $reason;
