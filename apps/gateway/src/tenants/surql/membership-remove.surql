-- Identity $identity leaves organisation $tenant; answers with the membership it had, if any.
DELETE membership
WHERE
  identity = $identity
  AND tenant = $tenant
RETURN BEFORE;
