-- Identity $identity accepts invitation $invitation to organisation $tenant: it joins with role
-- $role and the invitation is spent, in one transaction. The unique index refuses a second
-- membership of the pair, and then nothing is written and the invitation stays.
BEGIN TRANSACTION;
  CREATE type::record('membership', $id) SET
    identity = $identity,
    tenant = $tenant,
    role = $role
  RETURN NONE;
  DELETE type::record('invitation', $invitation) RETURN NONE;
COMMIT TRANSACTION;
