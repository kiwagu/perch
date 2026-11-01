/**
 * Finds every `*.shape.surql` and `*.commands.surql` under a source root, places
 * it in its component folder and module, and parses, types and compiles it. The
 * TypeScript sources are never read; only file names show where modules and
 * components are.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { basename, dirname, join, relative, sep } from 'node:path'

import type { Region } from '@workspace/data'
import type { ChangeSpec } from '@workspace/kernel'

import {
  type CommandHeader,
  parseCommandsFile,
  parseShapeFile,
  type ShapeHeader,
} from './annotations'
import { compileCommand } from './compile-command'
import { ModelingException } from './errors'
import { inferResultType, tablesOf } from './infer-types'
import type { SchemaModel } from './schema-structure'
import { parseShape, type ShapeAst } from './shape-dialect'

interface ComponentFile {
  readonly path: string
  readonly name: string
  readonly module: string
  readonly moduleDir: string
  readonly componentDir: string
}

export interface ShapeFile extends ComponentFile {
  readonly id: string
  readonly header: ShapeHeader
  readonly body: string
  readonly ast: ShapeAst
  readonly tables: readonly string[]
  readonly region: Region
  readonly resultType: string
}

export interface CommandEntry {
  readonly id: string
  readonly name: string
  readonly header: CommandHeader
  readonly body: string
  readonly tables: readonly string[]
  readonly region: Region
  readonly ops: readonly ChangeSpec[]
}

export interface CommandFile extends ComponentFile {
  readonly id: string
  readonly commands: readonly CommandEntry[]
}

export interface Collected {
  readonly shapes: readonly ShapeFile[]
  readonly commands: readonly CommandFile[]
  readonly problems: readonly string[]
}

const SKIP = new Set(['node_modules', 'dist', 'coverage'])

function surqlFiles(root: string, dir = root): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.isDirectory()) {
      return SKIP.has(entry.name) || entry.name.startsWith('.')
        ? []
        : surqlFiles(root, join(dir, entry.name))
    }

    return /\.(shape|commands)\.surql$/.test(entry.name) ? [join(dir, entry.name)] : []
  })
}

const posix = (path: string): string => path.split(sep).join('/')

function findModule(root: string, dir: string): { module: string; moduleDir: string } | undefined {
  let current = dir

  for (;;) {
    const file = readdirSync(current).find((name) => name.endsWith('.module.ts'))

    if (file) {
      return {
        module: file.slice(0, -'.module.ts'.length),
        moduleDir: posix(relative(root, current)),
      }
    }

    if (current === root || dirname(current) === current) {
      return undefined
    }

    current = dirname(current)
  }
}

function place(root: string, file: string, role: 'shape' | 'commands'): ComponentFile {
  const dir = dirname(file)
  const folder = basename(dir)
  const name = basename(file).slice(0, -`.${role}.surql`.length)
  const inComponent =
    name === folder &&
    (existsSync(join(dir, `${folder}.container.tsx`)) ||
      existsSync(join(dir, `${folder}.service.ts`)))

  if (!inComponent) {
    throw new ModelingException(
      `a ${role === 'shape' ? 'shape' : 'commands file'} lives in its component folder: expected ${folder}/${folder}.container.tsx or ${folder}/${folder}.service.ts beside a file named ${folder}.${role}.surql`,
    )
  }

  const found = findModule(root, dir)

  if (!found) {
    throw new ModelingException('no *.module.ts in this folder or above it')
  }

  return {
    path: posix(relative(root, file)),
    name,
    componentDir: posix(relative(root, dir)),
    ...found,
  }
}

function readShape(
  placed: ComponentFile,
  text: string,
  schema: SchemaModel,
  databases: ReadonlyMap<string, readonly string[]>,
): ShapeFile {
  const { header, body } = parseShapeFile(text)
  const ast = parseShape(body)
  const resultType = inferResultType(ast, header.params, schema)
  const tables = tablesOf(ast, header.params, schema)
  const unplaced = tables.find((table) => !databases.has(table))

  if (unplaced !== undefined) {
    throw new ModelingException(`reads table ${unplaced}, which no database of the schema defines`)
  }

  const where = (table: string): readonly string[] => databases.get(table) ?? []
  // A shape runs on one database: every table it reads must live in it.
  const shared = tables.reduce<readonly string[]>(
    (common, table) => common.filter((database) => where(table).includes(database)),
    tables.length > 0 ? where(tables[0] ?? '') : [],
  )

  if (tables.length > 0 && shared.length === 0) {
    const named = tables.map((table) => `${table} (${where(table).join(', ')})`).join(', ')

    throw new ModelingException(`reads tables of two databases: ${named}`)
  }

  const serverOnly = tables.find((table) => schema.tables[table]?.replicate === 'none')

  if (serverOnly && !header.server) {
    throw new ModelingException(
      `reads the server-only table ${serverOnly}; mark the shape -- @server or read a replicated table`,
    )
  }

  const region: Region = header.server
    ? 'server'
    : (schema.tables[tables[0] ?? '']?.region ?? 'server')

  return {
    ...placed,
    id: `${placed.module}.${placed.name}`,
    header,
    body,
    ast,
    tables,
    region,
    resultType,
  }
}

function readCommands(placed: ComponentFile, text: string, schema: SchemaModel): CommandFile {
  const id = `${placed.module}.${placed.name}`
  const commands = parseCommandsFile(text).map(({ header, body }) => ({
    id: `${id}.${header.name}`,
    name: header.name,
    header,
    body,
    ...compileCommand(header, body, schema),
  }))

  return { ...placed, id, commands }
}

/**
 * Collects the shapes and commands under `root` against the schema; `databases` names the
 * databases each table lives in (`tableDatabases`).
 */
export async function collect(
  root: string,
  schema: SchemaModel,
  databases: ReadonlyMap<string, readonly string[]>,
): Promise<Collected> {
  const shapes: ShapeFile[] = []
  const commands: CommandFile[] = []
  const problems: string[] = []

  for (const file of surqlFiles(root).sort()) {
    const role = file.endsWith('.shape.surql') ? 'shape' : 'commands'

    try {
      const placed = place(root, file, role)
      const text = readFileSync(file, 'utf8')

      if (role === 'shape') {
        shapes.push(readShape(placed, text, schema, databases))
      } else {
        commands.push(readCommands(placed, text, schema))
      }
    } catch (error) {
      if (!(error instanceof ModelingException)) {
        throw error
      }

      problems.push(`${posix(relative(root, file))}: ${error.message}`)
    }
  }

  return { shapes, commands, problems }
}
