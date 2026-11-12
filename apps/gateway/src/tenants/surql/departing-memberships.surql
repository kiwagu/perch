-- The memberships of identity $identity in organisations of any status, each with what its
-- departure needs: the organisation's id, key, database and status, the identity's role there,
-- and how many memberships the organisation has and how many of them are admins, the
-- identity's own among both. The order names the projected `key`.
SELECT
  tenant,
  tenant.key AS key,
  tenant.database AS database,
  tenant.status AS status,
  role,
  array::len(
    (
      SELECT VALUE id
      FROM membership
      WHERE tenant = $parent.tenant
    )
  ) AS members,
  array::len(
    (
      SELECT VALUE id
      FROM membership
      WHERE
        tenant = $parent.tenant
        AND role = 'admin'
    )
  ) AS admins
FROM membership
WHERE identity = $identity
ORDER BY key;
