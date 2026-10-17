-- Notes of the organisation: shared by every member through the tenant region. A note names
-- the member who wrote it; the gateway refuses a new note whose author is not the device's
-- own member. On the server nobody but the gateway reads or writes the table.

-- @region tenant
-- @id nte
DEFINE TABLE OVERWRITE note SCHEMAFULL PERMISSIONS NONE;

DEFINE FIELD OVERWRITE author ON note TYPE record<member>;
-- @crdt text
DEFINE FIELD OVERWRITE text ON note TYPE string
  ASSERT string::len($value) > 0
  AND string::len($value) <= 500;
DEFINE FIELD OVERWRITE created_at ON note TYPE datetime
  DEFAULT time::now()
  READONLY;
