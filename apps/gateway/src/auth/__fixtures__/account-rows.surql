-- The record ids of the rows of identity $identity (its key) in the directory, table by table: its
-- own row, its credential, its sessions, its pending links (a change of its email, a deletion of
-- the account, its reset links), its pending two-factor challenges with the rows counting their
-- codes, its passkeys' pending registrations, its second factor, its passkeys, its profile, its
-- settings, its memberships, and the server's copy of its private region $region (head,
-- snapshots, update log, projected records, bound peers).
RETURN {
  identity: (
    SELECT VALUE id FROM identity WHERE id = type::record('identity', $identity)
  ),
  account: (SELECT VALUE id FROM account WHERE identity = $identity),
  device_session: (SELECT VALUE id FROM device_session WHERE identity = $identity),
  verification: (
    SELECT VALUE id
    FROM verification
    WHERE
      identifier = string::concat('change-email:', $identity)
      OR identifier = string::concat('delete-account:', $identity)
      OR (
        `value` = $identity
        AND string::starts_with(identifier, 'reset-password:')
      )
      OR (
        `value` = $identity
        AND string::starts_with(identifier, '2fa-')
      )
      OR identifier IN (
        SELECT VALUE string::concat('2fa-attempts-', identifier)
        FROM verification
        WHERE
          `value` = $identity
          AND string::starts_with(identifier, '2fa-')
      )
      OR string::contains(`value`, string::concat('"userData":{"id":"', $identity, '"'))
  ),
  two_factor: (SELECT VALUE id FROM two_factor WHERE identity = $identity),
  passkey: (SELECT VALUE id FROM passkey WHERE identity = $identity),
  profile: (
    SELECT VALUE id FROM profile WHERE identity = type::record('identity', $identity)
  ),
  settings: (
    SELECT VALUE id FROM settings WHERE identity = type::record('identity', $identity)
  ),
  membership: (
    SELECT VALUE id FROM membership WHERE identity = type::record('identity', $identity)
  ),
  replica_head: (SELECT VALUE id FROM _replica_head WHERE region = $region),
  replica_snapshot: (SELECT VALUE id FROM _replica_snapshot WHERE region = $region),
  replica_update: (SELECT VALUE id FROM _replica_update WHERE region = $region),
  replica_projected: (SELECT VALUE id FROM _replica_projected WHERE region = $region),
  replica_peer: (SELECT VALUE id FROM _replica_peer WHERE region = $region)
};
