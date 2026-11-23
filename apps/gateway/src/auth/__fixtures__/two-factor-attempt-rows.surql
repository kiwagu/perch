-- The identifiers of the rows counting the codes of the pending two-factor challenges of identity
-- $identity (its key): `2fa-attempts-` before each challenge's own identifier, read while the
-- challenges are there, so a row counting codes is found later by its identifier alone.
SELECT VALUE string::concat('2fa-attempts-', identifier)
FROM verification
WHERE
  `value` = $identity
  AND string::starts_with(identifier, '2fa-');
