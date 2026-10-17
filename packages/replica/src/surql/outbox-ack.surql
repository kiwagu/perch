-- Exactly the rows the server acknowledged, by record id: a number alone may be shared by a
-- row another engine on the same database appended concurrently.
DELETE $ids;
