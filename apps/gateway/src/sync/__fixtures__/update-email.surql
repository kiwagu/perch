-- A device changes its identity's profile email: a field devices may not change, so the
-- gateway refuses the batch.
UPDATE $id SET email = $email;
