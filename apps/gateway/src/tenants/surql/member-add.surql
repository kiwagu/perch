-- In the organisation's database: identity $identity (its key) is a member with role $role.
UPSERT type::record('member', $identity) SET role = $role;
