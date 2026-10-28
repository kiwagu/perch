-- Storage of the CRDT replication documents: the latest full snapshot of each region,
-- the update log written since that snapshot, the outbox of local updates not yet
-- acknowledged by a server, the records each region has projected, and the identity each
-- Loro peer of a region writes as. Bytes are
-- opaque to the database. The head row numbers a region's update log without gaps;
-- on a device it also holds the region's generation, which moves when the device drops the
-- region's local copy: a document of an earlier generation can no longer write to the log or
-- read from it. The cursor remembers how far a client has pulled from the server. These tables are
-- infrastructure, not data: closed to every record user and never replicated.

-- @replicate none
DEFINE TABLE OVERWRITE _replica_snapshot SCHEMAFULL PERMISSIONS NONE;
DEFINE FIELD OVERWRITE region ON _replica_snapshot TYPE string;
DEFINE FIELD OVERWRITE bytes ON _replica_snapshot TYPE bytes;
DEFINE FIELD OVERWRITE version ON _replica_snapshot TYPE bytes;
DEFINE FIELD OVERWRITE covers ON _replica_snapshot TYPE int DEFAULT 0;

DEFINE INDEX OVERWRITE replica_snapshot_region ON _replica_snapshot FIELDS region;

-- @replicate none
DEFINE TABLE OVERWRITE _replica_update SCHEMAFULL PERMISSIONS NONE;
DEFINE FIELD OVERWRITE region ON _replica_update TYPE string;
DEFINE FIELD OVERWRITE seq ON _replica_update TYPE int;
DEFINE FIELD OVERWRITE bytes ON _replica_update TYPE bytes;
DEFINE FIELD OVERWRITE version ON _replica_update TYPE option<bytes>;

-- A number is a region's own: a second row under it, which two writers racing on one
-- database could otherwise leave behind, fails its transaction, which is then replayed.
DEFINE INDEX OVERWRITE replica_update_seq ON _replica_update FIELDS region, seq
  UNIQUE;

-- @replicate none
DEFINE TABLE OVERWRITE _replica_outbox SCHEMAFULL PERMISSIONS NONE;
DEFINE FIELD OVERWRITE region ON _replica_outbox TYPE string;
DEFINE FIELD OVERWRITE seq ON _replica_outbox TYPE int;
DEFINE FIELD OVERWRITE bytes ON _replica_outbox TYPE bytes;

DEFINE INDEX OVERWRITE replica_outbox_seq ON _replica_outbox FIELDS region, seq
  UNIQUE;

-- Which records of each region the projector has written into their tables, kept in
-- the same transaction as each write, so a deletion that failed can still be found
-- and repaired after a reload, when the document no longer holds the record.
-- @replicate none
DEFINE TABLE OVERWRITE _replica_projected SCHEMAFULL PERMISSIONS NONE;
DEFINE FIELD OVERWRITE region ON _replica_projected TYPE string;
DEFINE FIELD OVERWRITE key ON _replica_projected TYPE string;

DEFINE INDEX OVERWRITE replica_projected_region ON _replica_projected FIELDS region;

-- The identity each Loro peer of a region writes as: bound by the first batch accepted with
-- changes of the peer, so a batch of another identity under the same peer is refused. The
-- record is keyed by region and peer; a peer is Loro's decimal text of a 64-bit number.
-- @replicate none
DEFINE TABLE OVERWRITE _replica_peer SCHEMAFULL PERMISSIONS NONE;
DEFINE FIELD OVERWRITE region ON _replica_peer TYPE string;
DEFINE FIELD OVERWRITE peer ON _replica_peer TYPE string;
DEFINE FIELD OVERWRITE identity ON _replica_peer TYPE string;

DEFINE INDEX OVERWRITE replica_peer_region ON _replica_peer FIELDS region;

-- @replicate none
DEFINE TABLE OVERWRITE _replica_head SCHEMAFULL PERMISSIONS NONE;
DEFINE FIELD OVERWRITE region ON _replica_head TYPE string;
DEFINE FIELD OVERWRITE head ON _replica_head TYPE int DEFAULT 0;
DEFINE FIELD OVERWRITE covers ON _replica_head TYPE int DEFAULT 0;
DEFINE FIELD OVERWRITE generation ON _replica_head TYPE int DEFAULT 0;

-- @replicate none
DEFINE TABLE OVERWRITE _replica_cursor SCHEMAFULL PERMISSIONS NONE;
DEFINE FIELD OVERWRITE region ON _replica_cursor TYPE string;
DEFINE FIELD OVERWRITE pulled ON _replica_cursor TYPE int DEFAULT 0;
