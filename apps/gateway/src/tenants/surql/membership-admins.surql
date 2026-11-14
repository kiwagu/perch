-- How many admins organisation $tenant counts.
RETURN array::len(
  (
    SELECT VALUE id
    FROM membership
    WHERE
      tenant = $tenant
      AND role = 'admin'
  )
);
