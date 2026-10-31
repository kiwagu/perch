-- The key of the identity whose email is $email (in lower case, as identities keep it), or NONE.
SELECT VALUE record::id(id)
FROM ONLY identity
WHERE email = string::lowercase($email)
LIMIT 1;
