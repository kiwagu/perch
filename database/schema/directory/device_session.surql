-- One row per device of an identity: what the gateway knows of the devices that signed in,
-- for the "My devices" page and for signing a device out from another one. The gateway
-- writes it as the namespace user and serves it over its routes; nobody reads it directly.

-- @replicate none
-- @id dvs
DEFINE TABLE OVERWRITE device_session SCHEMAFULL
  PERMISSIONS
    FOR select, create, update, delete NONE;

DEFINE FIELD OVERWRITE identity ON device_session TYPE record<identity>;
-- The browser's own stable id, minted on first use.
DEFINE FIELD OVERWRITE device ON device_session TYPE string
  ASSERT string::len($value) > 0
  AND string::len($value) <= 64;
-- A short description of the device, such as "Chrome on Linux".
DEFINE FIELD OVERWRITE label ON device_session TYPE string
  ASSERT string::len($value) <= 60;
-- The id of the device's current refresh grant: replaced on every renewal of its pair.
DEFINE FIELD OVERWRITE grant ON device_session TYPE string;
DEFINE FIELD OVERWRITE created_at ON device_session TYPE datetime
  DEFAULT time::now()
  READONLY;
DEFINE FIELD OVERWRITE last_seen_at ON device_session TYPE datetime
  DEFAULT time::now();
-- When the device's current session started: the second its latest sign-in's access token was
-- issued in, moved by every sign-in. A token issued in an earlier second belongs to an earlier
-- session of the device, one a sign-out may have ended, and the gateway refuses it.
DEFINE FIELD OVERWRITE started_at ON device_session TYPE datetime;
DEFINE FIELD OVERWRITE revoked_at ON device_session TYPE option<datetime>;

DEFINE INDEX OVERWRITE device_session_identity_device ON device_session FIELDS identity, device
  UNIQUE;
