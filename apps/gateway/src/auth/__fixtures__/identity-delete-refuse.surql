-- Makes the directory refuse to delete any identity: the last write of the removal of an account,
-- so every write before it in its transaction is undone too.
DEFINE EVENT OVERWRITE refuse_identity_delete ON identity
  WHEN $event = 'DELETE'
  THEN {
    THROW 'the directory refused to delete an identity';
  };
