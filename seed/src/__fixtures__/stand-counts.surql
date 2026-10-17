-- What seeding left on a stand for the given accounts: the identities at their addresses,
-- the profiles of their identity keys, the rows of their private regions, and how many
-- batches the server accepted into those regions.
RETURN {
  identities: array::len(SELECT VALUE id FROM identity WHERE email IN $emails),
  profiles: array::len(
    SELECT VALUE id FROM profile WHERE record::id(identity) IN $ids
  ),
  regionRows: array::len(
    SELECT VALUE id FROM _replica_head WHERE region IN $regions
  ) + array::len(
    SELECT VALUE id FROM _replica_snapshot WHERE region IN $regions
  ) + array::len(SELECT VALUE id FROM _replica_update WHERE region IN $regions) + array::len(
    SELECT VALUE id FROM _replica_projected WHERE region IN $regions
  ),
  accepted: math::sum(
    SELECT VALUE head FROM _replica_head WHERE region IN $regions
  ),
};
