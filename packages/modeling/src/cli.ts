#!/usr/bin/env bun
/**
 * The modeling CLI.
 *
 *   model --root <dir> [--schema <dir>] [--suites <dir>] [--check]
 *
 * Validates every `.surql` file, reads the schema into a model, cross-checks the
 * entity id registry, collects the shapes and commands under the root, and writes
 * the generated files (removing stale ones). With --check it writes nothing and
 * fails when any generated file is missing, different or stale, so a hook that
 * forgot to regenerate cannot pass silently. Exit code 1 on any problem.
 */

import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'

import { registry } from '@workspace/ids'

import { type CommandFile, collect, type ShapeFile } from './collect'
import { emitModel, emitReplicaSchema, type GeneratedFile } from './emit-model'
import { emitPagesModel, emitSurrealkitSuites } from './emit-reports'
import { checkIdRegistry } from './id-registry'
import { loadSchemaModel } from './schema-structure'

export interface ModelOptions {
  readonly root: string
  readonly schemaDir: string
  readonly suitesDir: string
  readonly check: boolean
}

export interface ModelResult {
  readonly problems: readonly string[]
  readonly written: readonly string[]
}

/** The table of the record access whose users the generated suites sign in as. */
const ACCESS_TABLE = 'user'

function filesUnder(dir: string, match: (name: string) => boolean): string[] {
  if (!existsSync(dir)) {
    return []
  }

  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)

    if (entry.isDirectory()) {
      return entry.name === 'node_modules' || entry.name.startsWith('.')
        ? []
        : filesUnder(path, match)
    }

    return match(entry.name) ? [path] : []
  })
}

function validate(files: readonly string[]): string[] {
  if (files.length === 0) {
    return []
  }

  const result = spawnSync('surreal', ['db', 'validate', ...files], { encoding: 'utf8' })

  if (result.error) {
    return [`surreal db validate could not run (${result.error.message}); install the surreal CLI`]
  }

  const lines = `${result.stdout}\n${result.stderr}`.split('\n')
  const problems: string[] = []

  for (const [index, line] of lines.entries()) {
    const failed = /^(.*\.surql): FAIL$/.exec(line.trim())

    if (failed?.[1]) {
      problems.push(`${failed[1]}: ${lines[index + 1]?.trim() ?? 'does not parse'}`)
    }
  }

  return result.status === 0 || problems.length > 0 ? problems : ['surreal db validate failed']
}

function bundles(
  shapes: readonly ShapeFile[],
  commands: readonly CommandFile[],
): Array<{ shape?: ShapeFile; commands?: CommandFile }> {
  const byDir = new Map<string, { shape?: ShapeFile; commands?: CommandFile }>()

  for (const shape of shapes) {
    byDir.set(shape.componentDir, { ...byDir.get(shape.componentDir), shape })
  }

  for (const file of commands) {
    byDir.set(file.componentDir, { ...byDir.get(file.componentDir), commands: file })
  }

  return [...byDir.entries()]
    .sort(([left], [right]) => (left < right ? -1 : 1))
    .map(([, bundle]) => bundle)
}

const GENERATED = (name: string): boolean =>
  name.endsWith('.model.gen.ts') ||
  name.endsWith('.surql.d.ts') ||
  name === 'pages.model.json' ||
  name === 'replica.schema.gen.ts'

export async function runModel(options: ModelOptions): Promise<ModelResult> {
  const schemaFiles = filesUnder(options.schemaDir, (name) => name.endsWith('.surql')).sort()
  const sourceFiles = filesUnder(options.root, (name) =>
    /\.(shape|commands)\.surql$/.test(name),
  ).sort()
  const syntax = validate([...schemaFiles, ...sourceFiles])

  if (syntax.length > 0) {
    return { problems: syntax, written: [] }
  }

  const schemaText = schemaFiles.map((file) => readFileSync(file, 'utf8')).join('\n')
  const loaded = await loadSchemaModel(schemaText)

  if (loaded.isErr()) {
    return {
      problems: [
        `the schema could not be applied: ${String(loaded.error.cause ?? loaded.error.message)}`,
      ],
      written: [],
    }
  }

  const { model, problems: schemaProblems } = loaded.value
  const registryProblems = checkIdRegistry(model, registry.prefixes)
  const collected = await collect(options.root, model)
  const problems = [...schemaProblems, ...registryProblems, ...collected.problems]

  if (problems.length > 0) {
    return { problems, written: [] }
  }

  const expected: Array<GeneratedFile & { readonly base: string }> = [
    ...bundles(collected.shapes, collected.commands).flatMap((bundle) =>
      emitModel(bundle, model).map((file) => ({ ...file, base: options.root })),
    ),
    {
      path: 'pages.model.json',
      text: emitPagesModel(collected.shapes, collected.commands),
      base: options.root,
    },
    { path: 'replica.schema.gen.ts', text: emitReplicaSchema(model), base: options.root },
    ...emitSurrealkitSuites(collected.shapes, ACCESS_TABLE).map((suite) => ({
      path: suite.path,
      text: suite.toml,
      base: options.suitesDir,
    })),
  ]
  const expectedPaths = new Set(expected.map((file) => resolve(file.base, file.path)))
  const stale = [
    ...filesUnder(options.root, GENERATED),
    ...filesUnder(
      options.suitesDir,
      (name) => name.startsWith('generated-') && name.endsWith('.toml'),
    ),
  ].filter((path) => !expectedPaths.has(resolve(path)))
  const changed = expected.filter((file) => {
    const path = join(file.base, file.path)

    return !existsSync(path) || readFileSync(path, 'utf8') !== file.text
  })

  if (options.check) {
    return {
      problems: [
        ...changed.map((file) => `out of date: ${file.path}`),
        ...stale.map(
          (path) =>
            `stale: ${relative(path.startsWith(options.root) ? options.root : options.suitesDir, path)}`,
        ),
      ],
      written: [],
    }
  }

  for (const file of changed) {
    const path = join(file.base, file.path)

    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, file.text)
  }

  for (const path of stale) {
    rmSync(path)
  }

  return { problems: [], written: changed.map((file) => file.path) }
}

function findUp(start: string, target: string): string | undefined {
  let current = resolve(start)

  for (;;) {
    if (existsSync(join(current, target))) {
      return join(current, target)
    }

    if (dirname(current) === current) {
      return undefined
    }

    current = dirname(current)
  }
}

export async function main(argv: readonly string[]): Promise<number> {
  const value = (flag: string): string | undefined => {
    const index = argv.indexOf(flag)

    return index >= 0 ? argv[index + 1] : undefined
  }
  const root = resolve(value('--root') ?? 'src')
  const schemaDir = value('--schema') ?? findUp(root, 'database/schema')
  const suitesDir = value('--suites') ?? findUp(root, 'database/tests/suites')

  if (!schemaDir || !suitesDir) {
    console.error(
      'model: could not find database/schema and database/tests/suites; pass --schema and --suites',
    )

    return 1
  }

  const result = await runModel({ root, schemaDir, suitesDir, check: argv.includes('--check') })

  for (const problem of result.problems) {
    console.error(`model: ${problem}`)
  }

  if (result.problems.length === 0) {
    console.log(
      argv.includes('--check')
        ? 'model: generated files are up to date'
        : `model: ${result.written.length} file(s) written`,
    )
  }

  return result.problems.length === 0 ? 0 : 1
}

if (import.meta.main) {
  process.exit(await main(process.argv.slice(2)))
}
