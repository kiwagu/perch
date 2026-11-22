-- Every row of `verification`, the earliest written first: its identifier and its value.
SELECT identifier, `value`
FROM verification
ORDER BY created_at, identifier;
