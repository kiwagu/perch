-- Gives the identity whose email is $email, in any case (identities keep it in lower case), the
-- platform role $role, and nothing else: answers the key of the identity it changed, or nothing
-- when no identity has the email. A role the schema does not allow is refused.
UPDATE identity SET
  role = $role
WHERE email = string::lowercase($email)
RETURN VALUE record::id(id);
