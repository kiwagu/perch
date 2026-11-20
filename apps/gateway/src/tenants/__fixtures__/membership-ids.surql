-- The ids of the memberships of the organisations `$tenants`.
SELECT VALUE id FROM membership WHERE tenant IN $tenants;
