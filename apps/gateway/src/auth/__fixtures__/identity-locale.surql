-- The language stored on the identity of $email (lower case), for a spec that reads it back.
SELECT VALUE locale FROM ONLY identity WHERE email = $email LIMIT 1;
