-- Notes of the organisation. Each command becomes operations on the tenant region of the
-- current organisation; a new note names the member who writes it.

-- @command createNote($id: record<note>, $author: record<member>, $text: string)
-- @allow record
CREATE $id SET author = $author, text = $text;

-- @command updateNote($id: record<note>, $text: string)
-- @allow record
UPDATE $id SET text = $text;

-- @command deleteNote($id: record<note>)
-- @allow record
DELETE $id;
