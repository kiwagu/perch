-- The identities $ids names, with their emails.
SELECT id, email FROM identity WHERE id IN $ids;
