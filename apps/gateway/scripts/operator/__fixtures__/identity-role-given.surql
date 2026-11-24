-- Gives identity $key the platform role $role, written directly.
UPDATE type::record('identity', $key) SET role = $role RETURN NONE;
