-- The organisation's database holds its schema and its first member: it is ready for use.
UPDATE type::record('tenant', $id) SET status = 'ready';
