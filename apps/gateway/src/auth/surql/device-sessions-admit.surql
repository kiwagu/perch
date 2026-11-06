-- Admits the sign-in whose new session holds token $session_token against the limit of $limit
-- devices one account keeps signed in at once, judged at $now in one transaction: the account's
-- devices with a live session are counted, the new session's own device included and a device
-- with several live sessions once, so two sign-ins judged at once see each other's sessions. The
-- sign-in is admitted as it is (`admitted`) within the limit, and when its session is no longer
-- live. Past it, a sign-in not confirmed ($sign_out_oldest false) leaves nothing: its session,
-- never handed to its device, is deleted (`asked`). A confirmed one signs out the other device
-- seen least recently (by `last_seen_at`, then by its id): its live sessions end at $now and keep
-- `device-limit` as their reason (`signed-out`, with that `device`).
BEGIN TRANSACTION;
  LET $own = (
    SELECT
      identity,
      device
    FROM ONLY device_session
    WHERE
      token = $session_token
      AND ended_at = NONE
      AND expires_at > $now
    LIMIT 1
  );
  LET $live = IF $own = NONE {
    [];
  } ELSE {
    SELECT
      device,
      time::max(last_seen_at) AS seen_at
    FROM device_session
    WHERE
      identity = $own.identity
      AND ended_at = NONE
      AND expires_at > $now
    GROUP BY device;
  };
  LET $outcome = IF array::len($live) <= $limit {
    'admitted';
  } ELSE IF $sign_out_oldest {
    'signed-out';
  } ELSE {
    'asked';
  };
  IF $outcome = 'asked' {
    DELETE device_session WHERE token = $session_token RETURN NONE;
  };
  LET $oldest = IF $outcome = 'signed-out' {
    (
      SELECT
        device,
        seen_at
      FROM $live
      WHERE device != $own.device
      ORDER BY seen_at ASC, device ASC
      LIMIT 1
    )[0].device;
  } ELSE {
    NONE;
  };
  IF $oldest != NONE {
    UPDATE device_session SET
      ended_reason = 'device-limit',
      ended_at = $now,
      expires_at = $now
    WHERE
      identity = $own.identity
      AND device = $oldest
      AND ended_at = NONE
      AND expires_at > $now
    RETURN NONE;
  };
  RETURN { outcome: $outcome, device: $oldest };
COMMIT TRANSACTION;
