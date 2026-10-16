-- Makes every delete of a profile fail, as a broken database would.
DEFINE EVENT OVERWRITE refuse_deletes ON profile
  WHEN $event = 'DELETE'
  THEN {
    THROW 'profile deletes are refused for this test';
  };
