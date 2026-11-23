-- Judges at $now how the admission of a sign-in of identity $identity (its key) on device $device
-- would take it (`device-sessions-admit.surql`), before any session of it is written, judging as
-- that admission judges and writing nothing: a banned account lets nothing in (`banned`);
-- otherwise a sign-in that would bring the account past the limit of $limit devices, its devices
-- counted as the admission counts them (`fn::devices_signed_in_with` of the schema), would be asked
-- (`asked`), and one within it admitted (`admitted`). A sign-in's code step judges it so before its
-- code is checked, so a sign-in the limit asks about checks and spends no code.
LET $banned = type::record('identity', $identity).banned = true;
RETURN IF $banned {
  'banned';
} ELSE IF array::len(fn::devices_signed_in_with($identity, $device, $now)) <= $limit {
  'admitted';
} ELSE {
  'asked';
};
