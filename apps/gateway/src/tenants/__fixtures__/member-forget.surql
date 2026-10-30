-- Drops the member row of identity $identity (its key) from an organisation's database, as an
-- invite that failed after its directory membership would leave it.
DELETE type::record('member', $identity);
