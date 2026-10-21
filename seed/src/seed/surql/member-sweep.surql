-- In an organisation's database: the member rows of the identities `$identities` (their keys)
-- go, as the gateway removes a member.
FOR $identity IN $identities {
  DELETE type::record('member', $identity);
};
