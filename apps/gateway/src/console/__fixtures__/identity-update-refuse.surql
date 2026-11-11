-- Makes the directory refuse every change of an identity: a write of a ban, so every write of its
-- transaction is undone too.
DEFINE EVENT OVERWRITE refuse_identity_update ON identity
  WHEN $event = 'UPDATE'
  THEN {
    THROW 'the directory refused to change an identity';
  };
