-- The role held in organisation $tenant by the identity whose email is $email (lower case), or
-- NONE when no member of it has that email.
SELECT VALUE role
FROM ONLY membership
WHERE
  tenant = $tenant
  AND identity.email = $email
LIMIT 1;
