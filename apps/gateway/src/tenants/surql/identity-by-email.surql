-- The identity that signs in with $email, in any case, or NONE.
SELECT id,
email
FROM ONLY identity
WHERE email = string::lowercase($email)
LIMIT 1;
