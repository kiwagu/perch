-- Identity $identity leaves organisation $tenant; nothing changes when it was no member.
DELETE membership
WHERE
  identity = $identity
  AND tenant = $tenant
RETURN NONE;
