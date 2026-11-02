-- Ends every reset link of identity $identity (its key) but the one whose token is $link_token, the
-- newest: a new request's link replaces the links of the earlier ones.
DELETE verification
WHERE
  `value` = $identity
  AND string::starts_with(identifier, 'reset-password:')
  AND identifier != string::concat('reset-password:', $link_token)
RETURN NONE;
