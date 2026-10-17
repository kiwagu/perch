-- The members an organisation's database holds, by the key of their identity: admins first.
SELECT record::id(id) AS identity, role FROM member ORDER BY role;
