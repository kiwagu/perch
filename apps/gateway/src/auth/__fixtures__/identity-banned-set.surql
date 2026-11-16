-- Sets the ban flag of identity $identity (its key) to $banned directly, ending none of its
-- sessions: the state a ban leaves for a session written after it committed.
UPDATE type::record('identity', $identity) SET banned = $banned RETURN NONE;
