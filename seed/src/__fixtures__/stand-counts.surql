-- What a seed leaves on a stand: test accounts, profiles and region documents.
RETURN {
  accounts: array::len(
    SELECT VALUE id
    FROM identity
    WHERE string::ends_with(email, '@example.test')
  ),
  profiles: array::len(SELECT VALUE id FROM profile),
  regions: array::len(array::distinct(SELECT VALUE region FROM _replica_update)),
};
