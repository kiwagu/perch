-- Makes the directory refuse every new identity with an error that names its email, as a database
-- error may name a value it was given.
DEFINE EVENT OVERWRITE refuse_identity ON identity
  WHEN $event = 'CREATE'
  THEN {
    THROW 'MARKER the directory refused ' + $after.email;
  };
