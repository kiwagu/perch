-- Ends the pending two-factor challenge whose identifier is $identifier: its row and the row
-- counting its codes (`fn::two_factor_challenge_end`). Ending one that is gone ends nothing.
fn::two_factor_challenge_end($identifier);
