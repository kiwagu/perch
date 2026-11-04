-- Deletes every row of the account of identity $identity (its key) from the directory, as one
-- transaction, the identity last: its sessions, its credential row, its pending links (the change
-- of its email, the deletion of the account, and its reset links, which Better Auth keeps under
-- `reset-password:<token>` with the identity's key as their value), its profile and settings, and
-- the server's copy of its private region $region (head, snapshots, update log, projected
-- records, bound peers). A failure of any of these leaves all of them undone. An identity that
-- still has a membership is refused with nothing deleted: memberships, organisations and their
-- databases go with the account's departure from its organisations, before this runs. What is
-- gone already deletes nothing, so a second run changes nothing.
BEGIN TRANSACTION;
LET $record = type::record('identity', $identity);
IF array::len((SELECT VALUE id FROM membership WHERE identity = $record LIMIT 1)) > 0 {
  THROW 'the identity still belongs to an organisation';
};
DELETE device_session WHERE identity = $identity RETURN NONE;
DELETE account WHERE identity = $identity RETURN NONE;
DELETE verification WHERE identifier = string::concat('change-email:', $identity) RETURN NONE;
DELETE verification WHERE identifier = string::concat('delete-account:', $identity) RETURN NONE;
DELETE verification
WHERE
  `value` = $identity
  AND string::starts_with(identifier, 'reset-password:')
RETURN NONE;
DELETE profile WHERE identity = $record RETURN NONE;
DELETE settings WHERE identity = $record RETURN NONE;
DELETE _replica_head WHERE region = $region RETURN NONE;
DELETE _replica_snapshot WHERE region = $region RETURN NONE;
-- One region, matched with `=`: a delete matching the leading field of a composite index with
-- `IN` deletes nothing on SurrealDB 3.3.4.
DELETE _replica_update WHERE region = $region RETURN NONE;
DELETE _replica_projected WHERE region = $region RETURN NONE;
DELETE _replica_peer WHERE region = $region RETURN NONE;
DELETE $record RETURN NONE;
COMMIT TRANSACTION;
