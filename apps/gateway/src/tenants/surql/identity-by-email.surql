-- The identity that signs in with $email, or NONE.
SELECT id, email FROM ONLY identity WHERE email = $email LIMIT 1;
