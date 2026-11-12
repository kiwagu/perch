-- Makes the directory refuse to delete a pending change of an email: the last write of a reset
-- and of a change of a password, so every write before it in their transaction is undone too.
DEFINE EVENT OVERWRITE refuse_change_cancel ON verification
  WHEN $event = 'DELETE'
  AND string::starts_with($before.identifier, 'change-email:')
  THEN {
    THROW 'the directory refused to end a change of an email';
  };
