-- How each account signs in: its provider, its password hash and the identity it belongs to.
SELECT
  provider_id,
  password,
  identity
FROM account;
