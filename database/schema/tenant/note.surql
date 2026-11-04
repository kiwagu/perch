-- Notes of the organisation: shared by every member through the tenant region. A note names
-- the member who wrote it; a member edits and deletes only the notes it wrote, an admin any
-- note; the gateway refuses what the rules below forbid. On the server nobody but the
-- gateway reads or writes the table.

-- @region tenant
-- @id nte
-- @owner author
-- @can member create, update:own, delete:own
-- @can admin create, update, delete
DEFINE TABLE OVERWRITE note SCHEMAFULL PERMISSIONS NONE;

-- @readonly
DEFINE FIELD OVERWRITE author ON note TYPE record<member>;
-- @crdt text
DEFINE FIELD OVERWRITE text ON note TYPE string
  ASSERT string::len($value) > 0
  AND string::len($value) <= 500;
-- @readonly
DEFINE FIELD OVERWRITE created_at ON note TYPE datetime
  DEFAULT time::now()
  READONLY;
