-- The identifiers of every row Better Auth keeps for a pending two-factor challenge, sorted: the
-- challenge's own row (`2fa-<random>`, the identity's key as its value) and the row counting its
-- wrong codes (`2fa-attempts-2fa-<random>`).
SELECT VALUE identifier
FROM verification
WHERE string::starts_with(identifier, '2fa-')
ORDER BY identifier;
