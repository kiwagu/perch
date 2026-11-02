-- The `jti` of the pending change of the email of identity $identity (its key), or nothing when
-- none is pending.
SELECT VALUE `value` FROM verification WHERE identifier = string::concat('change-email:', $identity);
