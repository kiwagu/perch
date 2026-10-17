-- The role identity $identity holds in organisation $tenant, or NONE when it is not a member.
SELECT VALUE role
FROM ONLY membership
WHERE
  identity = $identity
  AND tenant = $tenant
LIMIT 1;
