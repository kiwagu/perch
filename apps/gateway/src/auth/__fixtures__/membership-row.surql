-- A membership of identity $identity (its key) in organisation $tenant (its key), as a member: one
-- that taking the account out of its organisations would have deleted.
CREATE membership SET
  identity = type::record('identity', $identity),
  tenant = type::record('tenant', $tenant),
  role = 'member';
