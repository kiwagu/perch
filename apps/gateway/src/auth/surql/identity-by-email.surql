-- The key and the email of the identity whose email is $email, in any case (identities keep it in
-- lower case), or NONE.
SELECT record::id(id) AS key,
email
FROM ONLY identity
WHERE email = string::lowercase($email)
LIMIT 1;
