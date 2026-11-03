-- Makes the directory refuse the credential row of every identity whose email starts with
-- `refused-`: inside the sign-up's transaction, after its identity was written in it.
DEFINE EVENT OVERWRITE refuse_account ON account
  WHEN $event = 'CREATE'
  AND string::starts_with(
    type::record('identity', $after.identity).email ?? '',
    'refused-'
  )
  THEN {
    THROW 'the directory refused the credential row';
  };
