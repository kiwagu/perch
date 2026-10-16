# Local stands

- `surrealdb-dev` (profile `dev`): in-memory SurrealDB on 127.0.0.1:8000 for development.
- `surrealdb-e2e` (profile `e2e`): in-memory SurrealDB on 127.0.0.1:8010 for `bun run test:db`
  and the e2e launcher. Restart it to get an empty database.

Both run the `surrealdb/surrealdb:v3.3.4` image with root/root credentials and no persistence.
After a start, wait until the port is listening; `surreal sql --endpoint http://127.0.0.1:8010
--user root --pass root` opens a shell against the e2e stand.
