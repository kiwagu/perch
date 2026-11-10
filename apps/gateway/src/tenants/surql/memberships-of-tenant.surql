-- The memberships of organisation $tenant, the earliest first, each with the email of its
-- identity; a membership whose identity is gone comes without an `email`. The order names the
-- projected `created_at`.
SELECT
  identity,
  role,
  identity.email AS email,
  created_at
FROM membership
WHERE tenant = $tenant
ORDER BY created_at;
