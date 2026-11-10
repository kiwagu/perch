-- Deletes the memberships of the organisations `$tenants` by a list, as the seed's sweep does.
DELETE membership WHERE tenant IN $tenants;
