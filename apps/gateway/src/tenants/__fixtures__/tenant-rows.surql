-- The directory row of the organisation with key $key: its status and its database.
SELECT status, database FROM tenant WHERE key = $key;
