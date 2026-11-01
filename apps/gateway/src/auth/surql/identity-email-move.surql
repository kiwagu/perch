-- Changes the email of identity $identity (its key) from $from to $to, both in lower case:
-- answers the new email, or NONE when the identity is gone or its email is no longer $from.
UPDATE ONLY type::record('identity', $identity) SET
  email = $to,
  updated_at = time::now()
WHERE email = $from
RETURN VALUE email;
