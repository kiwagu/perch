-- Storage of the CRDT replication documents: the latest full snapshot of each region,
-- the update log written since that snapshot, the outbox of local updates not yet
-- acknowledged by a server, and the records each region has projected. Bytes are
-- opaque to the database. The head row numbers a region's update log without gaps;
-- the cursor remembers how far a client has pulled from the server. These tables are
-- infrastructure, not data: closed to every record user and never replicated.

-- @replicate none
DEFINE TABLE OVERWRITE _replica_snapshot SCHEMAFULL PERMISSIONS NONE;
DEFINE FIELD OVERWRITE region ON _replica_snapshot TYPE string;
DEFINE FIELD OVERWRITE bytes ON _replica_snapshot TYPE bytes;
DEFINE FIELD OVERWRITE version ON _replica_snapshot TYPE bytes;
DEFINE FIELD OVERWRITE covers ON _replica_snapshot TYPE int DEFAULT 0;

-- @replicate none
DEFINE TABLE OVERWRITE _replica_update SCHEMAFULL PERMISSIONS NONE;
DEFINE FIELD OVERWRITE region ON _replica_update TYPE string;
DEFINE FIELD OVERWRITE seq ON _replica_update TYPE int;
DEFINE FIELD OVERWRITE bytes ON _replica_update TYPE bytes;
DEFINE FIELD OVERWRITE version ON _replica_update TYPE option<bytes>;

-- @replicate none
DEFINE TABLE OVERWRITE _replica_outbox SCHEMAFULL PERMISSIONS NONE;
DEFINE FIELD OVERWRITE region ON _replica_outbox TYPE string;
DEFINE FIELD OVERWRITE seq ON _replica_outbox TYPE int;
DEFINE FIELD OVERWRITE bytes ON _replica_outbox TYPE bytes;

-- Which records of each region the projector has written into their tables, kept in
-- the same transaction as each write, so a deletion that failed can still be found
-- and repaired after a reload, when the document no longer holds the record.
-- @replicate none
DEFINE TABLE OVERWRITE _replica_projected SCHEMAFULL PERMISSIONS NONE;
DEFINE FIELD OVERWRITE region ON _replica_projected TYPE string;
DEFINE FIELD OVERWRITE key ON _replica_projected TYPE string;

-- @replicate none
DEFINE TABLE OVERWRITE _replica_head SCHEMAFULL PERMISSIONS NONE;
DEFINE FIELD OVERWRITE region ON _replica_head TYPE string;
DEFINE FIELD OVERWRITE head ON _replica_head TYPE int DEFAULT 0;
DEFINE FIELD OVERWRITE covers ON _replica_head TYPE int DEFAULT 0;

-- @replicate none
DEFINE TABLE OVERWRITE _replica_cursor SCHEMAFULL PERMISSIONS NONE;
DEFINE FIELD OVERWRITE region ON _replica_cursor TYPE string;
DEFINE FIELD OVERWRITE pulled ON _replica_cursor TYPE int DEFAULT 0;
