-- The organisation's settings: defaults it sets for its members, today the language an account
-- its invitation creates starts in, or none. One row per organisation, under an id derived from
-- its key (`organisation_settings:ost_<key>`), shared with every member through the tenant region.
-- Only an admin creates or changes it, and only through replication, which the gateway checks;
-- a member's own settings always win over it. On the server nobody but the gateway reads or
-- writes the table.

-- @region tenant
-- @id ost
-- @can admin create, update
DEFINE TABLE OVERWRITE organisation_settings SCHEMAFULL PERMISSIONS NONE;

DEFINE FIELD OVERWRITE locale ON organisation_settings TYPE option<string>
  ASSERT $value IN ['en', 'es'];
