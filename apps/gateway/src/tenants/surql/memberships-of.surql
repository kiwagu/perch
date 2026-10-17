-- The organisations identity $identity belongs to, with its role in each, by key; an
-- organisation still provisioning is nobody's yet. The order names the projected `key`: the
-- rows it sorts no longer hold `tenant`.
SELECT
  role,
  tenant.id AS id,
  tenant.key AS key,
  tenant.name AS name
FROM membership
WHERE
  identity = $identity
  AND tenant.status = 'ready'
ORDER BY key;
