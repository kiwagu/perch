-- In an organisation's own database: a member row for the identity whose key is $identity, as
-- the gateway writes one, whether or not the directory holds a membership behind it.
UPSERT type::record('member', $identity) SET role = 'member';
