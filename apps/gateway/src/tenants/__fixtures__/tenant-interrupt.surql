-- Leaves the organisation with key $key as a creation interrupted after its directory rows
-- would: still provisioning.
UPDATE tenant SET status = 'provisioning' WHERE key = $key;
