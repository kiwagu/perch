-- In the organisation's database: identity $identity (its key) is a member no more.
DELETE type::record('member', $identity);
