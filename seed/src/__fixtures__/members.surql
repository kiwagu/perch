-- In an organisation's own database: the identity keys of its member rows.
SELECT VALUE record::id(id) FROM member;
