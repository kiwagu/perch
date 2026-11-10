-- The memberships among the ids `$ids` that the directory still holds.
SELECT id FROM membership WHERE id IN $ids;
