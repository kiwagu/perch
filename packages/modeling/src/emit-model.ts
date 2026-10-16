/**
 * Writes the generated TypeScript of the modeling stage: one `<name>.model.gen.ts`
 * per component with its shape and commands, a `.surql.d.ts` beside each `.surql`
 * file so imports of it are typed, and the replica schema of replicated tables.
 */

import { type ParamDecl, pascalCase as pascal, surqlExportName } from '@workspace/data'

import type { CommandFile, ShapeFile } from './collect'
import { idTypeOf, renderFieldType } from './infer-types'
import type { SchemaModel } from './schema-structure'
import { type FieldType, parseTypeString } from './type-string'

export interface GeneratedFile {
  readonly path: string
  readonly text: string
}

export interface ComponentBundle {
  readonly shape?: ShapeFile
  readonly commands?: CommandFile
}

const IDENTIFIER = /^[A-Za-z_$][\w$]*$/

/** A TypeScript literal of plain data, in the workspace style. */
export function literal(value: unknown): string {
  if (typeof value === 'string') {
    return `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n')}'`
  }

  if (Array.isArray(value)) {
    return `[${value.map(literal).join(', ')}]`
  }

  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value).map(
      ([key, inner]) => `${IDENTIFIER.test(key) ? key : literal(key)}: ${literal(inner)}`,
    )

    return entries.length === 0 ? '{}' : `{ ${entries.join(', ')} }`
  }

  return String(value)
}

function zodOf(schema: SchemaModel, type: FieldType): string {
  switch (type.kind) {
    case 'scalar':
      return {
        string: 'z.string()',
        int: 'z.number().int()',
        float: 'z.number()',
        number: 'z.number()',
        decimal: 'z.string()',
        bool: 'z.boolean()',
        datetime: 'z.date()',
        uuid: 'z.string()',
        duration: 'z.string()',
        bytes: 'z.instanceof(Uint8Array)',
        any: 'z.unknown()',
      }[type.name]
    case 'record': {
      const [table] = type.tables

      return type.tables.length === 1 && table && schema.tables[table]?.idPrefix
        ? `idSchemas.${table}.schema`
        : 'z.string()'
    }
    case 'option':
      return `${zodOf(schema, type.inner)}.optional()`
    case 'array':
      return `z.array(${zodOf(schema, type.inner)})`
    case 'literal':
      return type.values.length === 1
        ? `z.literal(${literal(type.values[0])})`
        : `z.enum(${literal(type.values)})`
    case 'object': {
      const entries = Object.entries(type.fields)

      return entries.length === 0
        ? 'z.record(z.string(), z.unknown())'
        : `z.object({ ${entries.map(([name, inner]) => `${name}: ${zodOf(schema, inner)}`).join(', ')} })`
    }
  }
}

function paramsType(schema: SchemaModel, params: readonly ParamDecl[]): string {
  if (params.length === 0) {
    return 'Record<string, never>'
  }

  const fields = params.map((param) => {
    const type = parseTypeString(param.type)
    const optional = type.kind === 'option' ? '?' : ''

    return `${param.name}${optional}: ${renderFieldType(schema, type)}`
  })

  return `{ ${fields.join('; ')} }`
}

const paramsSchema = (schema: SchemaModel, params: readonly ParamDecl[]): string =>
  `z.object({ ${params.map((param) => `${param.name}: ${zodOf(schema, parseTypeString(param.type))}`).join(', ')} })`

function imports(schema: SchemaModel, body: string): string[] {
  const idTypes = Object.keys(schema.tables)
    .map((table) => idTypeOf(schema, table))
    .filter((name) => name !== 'string' && new RegExp(`\\b${name}\\b`).test(body))
    .sort()
  const dataTypes = ['Command', 'Shape'].filter((name) => new RegExp(`\\b${name}<`).test(body))
  const ids = [
    ...(body.includes('idSchemas.') ? ['idSchemas'] : []),
    ...idTypes.map((name) => `type ${name}`),
  ]
  const lines: string[] = []

  if (dataTypes.length > 0) {
    lines.push(`import type { ${dataTypes.join(', ')} } from '@workspace/data'`)
  }

  if (ids.length > 0) {
    lines.push(`import { ${ids.join(', ')} } from '@workspace/ids'`)
  }

  if (body.includes('z.')) {
    lines.push("import { z } from '@workspace/zod'")
  }

  return lines
}

function shapeSection(shape: ShapeFile, schema: SchemaModel): string[] {
  const name = pascal(shape.name)

  return [
    `export type ${name}Params = ${paramsType(schema, shape.header.params)}`,
    `export type ${name}Result = ${shape.resultType}`,
    `export const ${name}ParamsSchema = ${paramsSchema(schema, shape.header.params)}`,
    [
      `export const ${surqlExportName(shape.name, 'shape')}: Shape<${name}Params, ${name}Result> = {`,
      `  id: ${literal(shape.id)},`,
      "  kind: 'shape',",
      `  text: ${literal(shape.body.trim())},`,
      `  params: ${literal(shape.header.params)},`,
      `  tables: ${literal(shape.tables)},`,
      '}',
    ].join('\n'),
    `export type ${name}ShapeType = typeof ${surqlExportName(shape.name, 'shape')}`,
  ]
}

function commandsSection(file: CommandFile, schema: SchemaModel): string[] {
  const name = pascal(file.name)
  const perCommand = file.commands.flatMap((command) => [
    `export type ${pascal(command.name)}Params = ${paramsType(schema, command.header.params)}`,
    `export const ${pascal(command.name)}ParamsSchema = ${paramsSchema(schema, command.header.params)}`,
  ])
  const typeLines = file.commands.map(
    (command) => `  readonly ${command.name}: Command<${pascal(command.name)}Params>`,
  )
  const valueLines = file.commands.map((command) =>
    [
      `  ${command.name}: {`,
      `    id: ${literal(command.id)},`,
      "    kind: 'command',",
      `    text: ${literal(command.body.trim())},`,
      `    params: ${literal(command.header.params)},`,
      `    tables: ${literal(command.tables)},`,
      `    region: ${literal(command.region)},`,
      `    ops: ${literal(command.ops)},`,
      `    schema: ${pascal(command.name)}ParamsSchema,`,
      '  },',
    ].join('\n'),
  )

  return [
    ...perCommand,
    [
      `export const ${surqlExportName(file.name, 'commands')}: {`,
      ...typeLines,
      '} = {',
      ...valueLines,
      '}',
    ].join('\n'),
    `export type ${name}CommandsType = typeof ${surqlExportName(file.name, 'commands')}`,
  ]
}

export function emitModel(bundle: ComponentBundle, schema: SchemaModel): GeneratedFile[] {
  const source = bundle.shape ?? bundle.commands

  if (!source) {
    return []
  }

  const { componentDir, name } = source
  const sections = [
    ...(bundle.shape ? shapeSection(bundle.shape, schema) : []),
    ...(bundle.commands ? commandsSection(bundle.commands, schema) : []),
  ]
  const body = sections.join('\n\n')
  const sources = [bundle.shape?.path, bundle.commands?.path]
    .filter((path): path is string => path !== undefined)
    .map((path) => path.split('/').at(-1))
    .join(', ')
  const header = `// GENERATED by @workspace/modeling from ${sources}. Do not edit.`
  const model = [header, imports(schema, body).join('\n'), body].join('\n\n')
  const files: GeneratedFile[] = [
    { path: `${componentDir}/${name}.model.gen.ts`, text: `${model}\n` },
  ]
  const declaration = (role: string, typeName: string): GeneratedFile => ({
    path: `${componentDir}/${name}.${role}.surql.d.ts`,
    text: `// GENERATED by @workspace/modeling. Do not edit.\n\ndeclare const value: import('./${name}.model.gen').${typeName}\n\nexport default value\n`,
  })

  if (bundle.shape) {
    files.push(declaration('shape', `${pascal(name)}ShapeType`))
  }

  if (bundle.commands) {
    files.push(declaration('commands', `${pascal(name)}CommandsType`))
  }

  return files
}

/**
 * For every replicated table, the region whose documents hold its records and the
 * field kinds the replica's write path and projector need.
 */
export function emitReplicaSchema(schema: SchemaModel): string {
  const tables = Object.entries(schema.tables)
    .filter(([, table]) => table.region !== undefined)
    .sort(([left], [right]) => (left < right ? -1 : 1))
    .map(([name, table]) => {
      const fields: Record<string, unknown> = {}

      for (const [field, type] of Object.entries(table.fields)) {
        const inner = type.kind === 'option' ? type.inner : type
        const crdt = table.crdt?.[field]

        if (crdt) {
          fields[field] = { kind: crdt }
        } else if (inner.kind === 'record' && inner.tables.length === 1) {
          fields[field] = { kind: 'record', table: inner.tables[0] }
        } else if (inner.kind === 'scalar' && inner.name === 'datetime') {
          fields[field] = { kind: 'datetime' }
        }
      }

      return `  ${name}: ${literal({ region: table.region, fields })},`
    })

  return [
    '// GENERATED by @workspace/modeling from the database schema. Do not edit.',
    '',
    "import type { ReplicaSchema } from '@workspace/replica'",
    '',
    'export const replicaSchema: ReplicaSchema = {',
    ...tables,
    '}',
    '',
  ].join('\n')
}
