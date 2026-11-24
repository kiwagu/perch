-- In an organisation's database: a note $id with text $text, written by the member whose
-- identity has the key $author.
CREATE type::record('note', $id) SET
  author = type::record('member', $author),
  text = $text;
