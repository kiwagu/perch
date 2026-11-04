-- Makes identity $identity an admin of the organisation with key $key in the directory, as a
-- change of role would.
UPDATE membership SET
  role = 'admin'
WHERE
  identity = $identity
  AND tenant.key = $key;
