-- In an organisation's database: its notes, each with the identity key of its author.
SELECT record::id(author) AS author, text FROM note ORDER BY text;
