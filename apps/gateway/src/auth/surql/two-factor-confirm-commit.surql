-- Turns on the second factor of identity $identity (its key) at a code of the key of enrolment
-- $enrolment (the key of its two-factor row), as one transaction: the account's flag and the row's
-- `verified` change together, and only while the row is still the identity's own and the factor
-- is not on yet. Answers `confirmed`, or `changed` with nothing changed: the enrolment's row was
-- replaced or deleted, or the factor was turned on meanwhile.
BEGIN TRANSACTION;
  LET $account = (
    SELECT VALUE id
    FROM identity
    WHERE
      id = type::record('identity', $identity)
      AND (two_factor_enabled ?? false) = false
  );
  LET $row = (
    SELECT VALUE id
    FROM two_factor
    WHERE
      id = type::record('two_factor', $enrolment)
      AND identity = $identity
  );
  LET $stands = array::len($account) = 1 AND array::len($row) = 1;
  IF $stands {
    UPDATE $account SET
      two_factor_enabled = true,
      updated_at = time::now()
    RETURN NONE;
    UPDATE $row SET verified = true RETURN NONE;
  };
  RETURN IF $stands {
    'confirmed';
  } ELSE {
    'changed';
  };
COMMIT TRANSACTION;
