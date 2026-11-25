# Modeling (`@workspace/modeling`)

## Role in the architecture

The build-time modeling stage. It reads only `.surql` files (the shared schema and the
shapes and commands next to components) plus the folder layout, and the kernel's generated
`CONTRACT_VALUES` for the contract's length limits. It generates typed models, command operation
plans, a page model, permission suites and the limits as database parameters. It never reads
TypeScript or React code.

## Key exports

- CLI `model --root <dir> [--schema <dir>] [--suites <dir>] [--check]` (`main`, `runModel`):
  validates every `.surql` with `surreal db validate`, applies the schema (every file under
  the schema folder, all databases together) to an embedded database and reads its structure,
  cross-checks `-- @id` prefixes against the entity id registry, refuses a shape whose tables
  share no database (one shape reads one database; `tableDatabases` applies each database's
  schema, `common/` and then its own folder's files, to an embedded database of its own and reads
  its tables back, and reports a schema file outside `<database>/<name>.surql`), then writes per
  component
  `<name>.model.gen.ts` and `<name>.<role>.surql.d.ts`, plus `pages.model.json`, the
  `generated-<module>.toml` suites (shapes of the `tenant` region are left out: record users
  have no access to the tenant database on the server yet; a module with only such shapes
  gets no suite), the replica schema (every
  replicated table with its region and the kind of each of its fields) in the database workspace,
  `<database>/src/replica.schema.gen.ts`, and the contract's length limits as database
  parameters, `<schema>/common/contract-values.gen.surql` (see `emitValueParams`). `--check`
  writes nothing and fails on missing, different or stale output.
- CLI `lint-surql [--allow-role <table>.role=<value> ...] [dir ...]` (root `bun run lint:surql`,
  part of `lint` and `check`): fails on a string or template literal in TypeScript that holds a
  SurrealQL statement, read from the syntax tree with oxc-parser, and on a role a `.surql` file
  writes that the contract does not name (`CONTRACT_ROLES` of `@workspace/kernel`): a schema's
  assert, a query or a fixture, so a role renamed in the contract fails here until SurrealQL
  follows. `--allow-role` lets one field of one table hold a value that is no role, in its field's
  definition alone; the root script allows `identity.role=user`, the auth library's word for an
  account with no platform role. The modeling sources are exempt: their tests feed SurrealQL to
  the parsers.
- `findSurqlLiterals`: the literal check for one file; `findSurqlRoles` (`src/surql-roles.ts`):
  the role check for one `.surql` file.
- `parseShapeFile`, `parseCommandsFile`, `parseShape`, `tokenize`: the dialect parsers.
- `emitValueParams`: the text of `contract-values.gen.surql` for the contract's values
  (`CONTRACT_VALUES` of `@workspace/kernel`, which the stage reads): one `DEFINE PARAM OVERWRITE
  $<value>_max_length VALUE <n>;` for each value with a `maxLength`, the value's name with `-` and
  `.` as `_`, in the order of the names, under a GENERATED header. An assert of the schema may
  name a parameter (`string::len($value) <= $profile_name_max_length`) instead of writing the
  number. A problem: `the values <a> and <b> name the same database parameter $<name>` (two
  limited values whose names map to one parameter).
- `valueParamName`: the name of the parameter that holds the limit of a value (`profile.name` is
  `profile_name_max_length`), the one rule `emitValueParams` names its parameters by, for a check
  that finds the value a parameter backs.
- `loadSchemaModel`, `parseStructure`: the schema model with its annotations
  (`@region private|public|tenant`, `@replicate none`, `@id`, `@crdt`, `@owner`, `@can`,
  `@readonly`) and their problems. Each table also carries `asserts` (the `ASSERT` clause of each
  field that has one, by field name, worded as the database prints it) and `indexes` (each index
  by name, with its fields and whether it is unique), so a check can hold the schema's limits to
  another model. The result also carries `params`: each parameter the schema defines
  (`DEFINE PARAM`) by name, with the value the database holds as text (`'80'`), so an assert that
  names a parameter can be resolved; the parameters the data layer stores for itself are left out.
  `-- @owner <field>` names the `record<member>` field that
  holds a record's author; `-- @can <member|admin> <action>[:own], …` (one line per role,
  actions `create`, `update`, `delete`, `:own` limiting the role to the records it owns)
  declares who may write a tenant table. The rules are emitted into the replica schema as
  `owner` and `can`. `-- @readonly` above a top-level field of a replicated table marks a field
  a device sets only when it creates the record; the replica schema carries it as
  `readonly: true` and the gateway refuses a batch that changes it.
  Problems: `-- @owner <field> must name a record<member> field`; `-- @can needs "<member|admin>
  <action>[:own], …", got "<line>"`; `-- @can <role>: unknown action "<item>"`; `-- @can <role>:
  create:own is not allowed, a created record is owned by its author`; `-- @can <role>: <item>
  needs -- @owner <field>`; `-- @can <role> is declared twice`; `@owner and @can belong to a
  replicated table, not to -- @replicate none`; `@owner and @can belong to a tenant table;
  <private|public> tables declare none`; `table <t>: field <f>: -- @readonly takes no value,
  got "<value>"`; `table <t>: field <f>: -- @readonly needs a replicated table (-- @region)`;
  `table <t>: field <f>: -- @readonly marks a top-level field only` (a dotted or wildcard
  field name).
- `inferResultType`, `tablesOf`, `compileCommand`, `checkIdRegistry`, `collect`, the emitters.

## Commands

- `bun run test`: unit tests, and CLI tests on a temporary module (needs the `surreal` CLI).
- `bun run typecheck`, `bun run lint`.
