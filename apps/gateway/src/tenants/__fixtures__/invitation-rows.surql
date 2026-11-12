-- Every invitation the directory holds, with the key of its organisation, for a test to read back.
SELECT tenant.key AS key, email FROM invitation ORDER BY key, email;
