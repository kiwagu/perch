-- Deletes invitation $id; answers the row it deleted, or nothing when it was not there.
DELETE type::record('invitation', $id) RETURN BEFORE;
