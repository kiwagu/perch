-- One row per sign-in of a device of an identity: Better Auth's session model, with the device's
-- own id and its label bound at sign-in. The gateway writes it as the namespace user and serves
-- it over its routes; nobody reads it directly. A session is live while `expires_at` lies in the
-- future; an ending (a sign-out, a sign-out from another device, a new sign-in of the device) sets
-- it and `ended_at` to the moment it ended and the row stays, so "My devices" lists a device
-- signed out from another one for 30 days. A device signs in again into a new row: the list shows
-- the latest row per device.

-- @replicate none
-- @id dvs
DEFINE TABLE OVERWRITE device_session SCHEMAFULL
  PERMISSIONS
    FOR select, create, update, delete NONE;

-- The key of the identity, as Better Auth's adapter writes and compares a reference: a plain
-- string, not a record id.
DEFINE FIELD OVERWRITE identity ON device_session TYPE string;
-- The session token the device holds; the credential of its routes and its hello.
DEFINE FIELD OVERWRITE token ON device_session TYPE string;
DEFINE FIELD OVERWRITE expires_at ON device_session TYPE datetime;
DEFINE FIELD OVERWRITE ip_address ON device_session TYPE option<string>;
DEFINE FIELD OVERWRITE user_agent ON device_session TYPE option<string>;
-- The browser's own stable id, minted on first use.
DEFINE FIELD OVERWRITE device ON device_session TYPE string
  ASSERT string::len($value) > 0
  AND string::len($value) <= 64;
-- A short description of the device, such as "Chrome on Linux".
DEFINE FIELD OVERWRITE label ON device_session TYPE string
  ASSERT string::len($value) <= 60;
DEFINE FIELD OVERWRITE created_at ON device_session TYPE datetime
  DEFAULT time::now()
  READONLY;
DEFINE FIELD OVERWRITE updated_at ON device_session TYPE datetime
  DEFAULT time::now();
DEFINE FIELD OVERWRITE last_seen_at ON device_session TYPE datetime
  DEFAULT time::now();
-- The moment the session was ended, set by every ending together with `expires_at` and never
-- moved or cleared afterwards. The gateway extends a live session when its device is seen, with
-- instants taken before its write lands; an ending that commits in between leaves `expires_at`
-- after those instants, so only this mark tells the write the session must stay ended. NONE
-- while the session is live, and once it merely expired.
DEFINE FIELD OVERWRITE ended_at ON device_session TYPE option<datetime>;
-- Why another device or the account's own change signed this one out, set with `ended_at` and
-- never changed afterwards, by an ending that found the session live, or by a ban, which ends
-- every session of the account not ended yet with its reason, an expired one too: `revoked`
-- (signed out from another device, or every device at once), `password-changed` (the account's
-- password changed, on another device or through a reset link), `device-limit` (a sign-in on
-- another device went past the account's limit of devices, this one seen least recently),
-- `banned` (an operator banned the account). The device hears it at its next hello, also after
-- it was offline when its session ended. NONE while the session is live, for an ending of the
-- device's own (its sign-out, a new sign-in of the device), for one that merely expired, and for
-- an expired session any other ending marked ended.
DEFINE FIELD OVERWRITE ended_reason ON device_session TYPE option<string>
  ASSERT $value = NONE
  OR $value IN ['revoked', 'password-changed', 'device-limit', 'banned'];
-- Whether the session waits for its admission: true from the moment a sign-in by email and
-- password, or the first verification of an email, writes it until the gateway admits it (a
-- sign-in's against the account's limit of devices, each against the account's ban), and the
-- session is handed to its device only then; a sign-in asked about the limit deletes it, and an
-- account found banned ends it. While it waits, no admission of another sign-in counts it, no list
-- of devices shows it, no caller reads it as a session and the device's earlier session stays
-- live; one whose admission failed stays so, never handed out. Every other session is admitted as
-- it is written.
DEFINE FIELD OVERWRITE pending ON device_session TYPE bool DEFAULT false;
-- Who acted as the account in this session, as Better Auth's admin plugin keeps it: the plugin's
-- impersonation is out of reach (its endpoints are switched off), so it stays NONE.
DEFINE FIELD OVERWRITE impersonated_by ON device_session TYPE option<string>;

DEFINE INDEX OVERWRITE device_session_token ON device_session FIELDS token
  UNIQUE;
DEFINE INDEX OVERWRITE device_session_identity_device ON device_session FIELDS identity, device;
