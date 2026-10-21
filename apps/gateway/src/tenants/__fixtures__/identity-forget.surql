-- Deletes identity $identity from the directory as the seed's sweep does, which leaves its
-- member rows in the organisations the sweep did not remove.
DELETE $identity;
