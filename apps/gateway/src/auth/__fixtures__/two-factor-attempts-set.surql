-- Sets the count of codes the row counting the codes of the two-factor challenge under identifier
-- $identifier holds (`2fa-attempts-` before it) to $value, as Better Auth writes it: a string.
UPDATE verification SET
  `value` = $value
WHERE identifier = string::concat('2fa-attempts-', $identifier)
RETURN NONE;
