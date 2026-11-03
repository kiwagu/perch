# Modeling (`@workspace/modeling`)

## Role in the architecture

The build-time modeling stage. It reads only `.surql` files (the shared schema and the
shapes and commands next to components) plus the folder layout, and generates typed
models, command operation plans, a page model and permission suites. It never reads
TypeScript or React code.

## Key exports

- CLI `model --root <dir> [--schema <dir>] [--suites <dir>] [--check]` (`main`, `runModel`):
  validates every `.surql` with `surreal validate`, applies the schema (every file under
  the schema folder, all databases together) to an embedded database and reads its structure,
  cross-checks `-- @id` prefixes against the entity id registry, refuses a shape whose tables
  share no database (one shape reads one database; `tableDatabases` applies each database's
  schema, `common/` and then its own folder's files, to an embedded database of its own and reads
  its tables back, and reports a schema file outside `<database>/<name>.surql`), then writes per
  component
  `<name>.model.gen.ts` and `<name>.<role>.surql.d.ts`, plus `pages.model.json`, the
  `generated-<module>.toml` suites (shapes of the `tenant` region are left out: record users
  have no access to the tenant database on the server yet; a module with only such shapes
  gets no suite) and the replica schema (every
  replicated table with its region and the kind of each of its fields) in the database workspace,
  `<database>/src/replica.schema.gen.ts`. `--check` writes nothing and fails on missing,
  different or stale output.
- CLI `lint-surql [dir ...]` (root `bun run lint:surql`, part of `lint` and `check`): fails on a
  string or template literal in TypeScript that holds a SurrealQL statement; reads the syntax
  tree with oxc-parser. The modeling sources are exempt: their tests feed SurrealQL to the parsers.
- `findSurqlLiterals`: the same check for one file.
- `parseShapeFile`, `parseCommandsFile`, `parseShape`, `tokenize`: the dialect parsers.
- `loadSchemaModel`, `parseStructure`: the schema model with its annotations
  (`@region private|public|tenant`, `@replicate none`, `@id`, `@crdt`, `@owner`, `@can`) and
  their problems. `-- @owner <field>` names the `record<member>` field that holds a record's
  author; `-- @can <member|admin> <action>[:own], …` (one line per role, actions `create`,
  `update`, `delete`, `:own` limiting the role to the records it owns) declares who may write
  a tenant table. The rules are emitted into the replica schema as `owner` and `can`.
  Problems: `-- @owner <field> must name a record<member> field`; `-- @can needs "<member|admin>
  <action>[:own], …", got "<line>"`; `-- @can <role>: unknown action "<item>"`; `-- @can <role>:
  create:own is not allowed, a created record is owned by its author`; `-- @can <role>: <item>
  needs -- @owner <field>`; `-- @can <role> is declared twice`; `@owner and @can belong to a
  replicated table, not to -- @replicate none`; `@owner and @can belong to a tenant table;
  <private|public> tables declare none`.
- `inferResultType`, `tablesOf`, `compileCommand`, `checkIdRegistry`, `collect`, the emitters.

## Commands

- `bun run test`: unit tests, and CLI tests on a temporary module (needs the `surreal` CLI).
- `bun run typecheck`, `bun run lint`.
