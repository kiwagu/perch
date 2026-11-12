-- Makes the directory refuse every change of a session row: the endings of a ban, so every write of
-- its transaction is undone too.
DEFINE EVENT OVERWRITE refuse_session_update ON device_session
  WHEN $event = 'UPDATE'
  THEN {
    THROW 'the directory refused to end a session';
  };
