-- Admits the session the first verification of an email signed in, which holds token
-- $session_token, at $now in one transaction, one admission of an account at a time (the gateway
-- takes the account's turn for it, beside its sign-ins' admissions). The session is found by its
-- token whatever became of it, to learn whose it is, and that account's ban is read in the same
-- transaction: a banned account lets nothing in (`banned`), its session ended `banned` unless the
-- ban ended it already, so whichever of the ban and the admission commits second sees the other.
-- Otherwise a live session waits no more and its device keeps it as its newest: the device's other
-- admitted sessions end with no reason, as at any new sign-in of the device (`admitted`); no limit
-- of devices is judged, as none is at a verification. A session no longer live (a reset, or another
-- ending of every session of the account, ended it meanwhile) is let in no more (`gone`).
BEGIN TRANSACTION;
  LET $row = (
    SELECT
      identity,
      device,
      ended_at,
      expires_at
    FROM ONLY device_session
    WHERE token = $session_token
    LIMIT 1
  );
  LET $outcome = IF $row = NONE {
    'gone';
  } ELSE IF type::record('identity', $row.identity).banned = true {
    'banned';
  } ELSE IF $row.ended_at = NONE
  AND $row.expires_at > $now {
    'admitted';
  } ELSE {
    'gone';
  };
  IF $outcome = 'banned' {
    -- Never handed out: ended as the ban ends every session, unless the ban ended it already.
    UPDATE device_session SET
      ended_reason = 'banned',
      ended_at = time::min([expires_at, $now]),
      expires_at = time::min([expires_at, $now])
    WHERE
      token = $session_token
      AND ended_at = NONE
    RETURN NONE;
  } ELSE IF $outcome = 'admitted' {
    UPDATE device_session SET
      pending = false
    WHERE token = $session_token
    RETURN NONE;
    -- The device keeps its newest admitted session, as `device-sessions-keep-newest.surql` keeps
    -- it for a session admitted as it is written: its other admitted ones end now, unended.
    UPDATE device_session SET
      ended_at = ended_at ?? time::min([expires_at, $now]),
      expires_at = time::min([expires_at, $now])
    WHERE
      identity = $row.identity
      AND device = $row.device
      AND ended_at = NONE
      AND pending = false
      AND id != (
        SELECT VALUE id
        FROM device_session
        WHERE
          identity = $row.identity
          AND device = $row.device
          AND pending = false
        ORDER BY created_at DESC, id DESC
        LIMIT 1
      )[0]
    RETURN NONE;
  };
  RETURN { outcome: $outcome };
COMMIT TRANSACTION;
