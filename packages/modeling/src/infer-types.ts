/**
 * Derives the TypeScript type of a shape's result and the set of tables it reads,
 * from its AST and the schema model. Records appear as the branded entity id type
 * of their table (or `string` for a table without an id prefix), because the data
 * layer hands record ids to application code as entity id strings.
 */

import { type ParamDecl, recordTableOf } from '@workspace/data'

import { ModelingException } from './errors'
import type { SchemaModel } from './schema-structure'
import type { PathStep, Projection, ShapeAst } from './shape-dialect'
import type { FieldType } from './type-string'

type Context =
  | { readonly kind: 'table'; readonly table: string }
  | { readonly kind: 'type'; readonly type: FieldType; readonly owner: string }

interface Resolved {
  readonly element: Context
  readonly many: boolean
  readonly optional: boolean
}

const pascal = (name: string): string =>
  name
    .split(/[_-]/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('')

/** The TypeScript name of a table's id type: `UserId` for a table with an id prefix, else `string`. */
export function idTypeOf(schema: SchemaModel, table: string): string {
  return schema.tables[table]?.idPrefix ? `${pascal(table)}Id` : 'string'
}

class Walker {
  readonly tables: string[] = []

  constructor(private readonly schema: SchemaModel) {}

  touch(table: string): void {
    if (!this.schema.tables[table]) {
      throw new ModelingException(`unknown table ${table}`)
    }

    if (!this.tables.includes(table)) {
      this.tables.push(table)
    }
  }

  /** A field of a table or an object; a record field is followed to its table. */
  field(context: Context, name: string): { type: FieldType; owner: string } {
    if (context.kind === 'table') {
      if (name === 'id') {
        return { type: { kind: 'record', tables: [context.table] }, owner: context.table }
      }

      const type = this.schema.tables[context.table]?.fields[name]

      if (!type) {
        throw new ModelingException(`${context.table} has no field ${name}`)
      }

      return { type, owner: context.table }
    }

    const type = context.type

    if (type.kind === 'record' && type.tables.length === 1 && type.tables[0]) {
      this.touch(type.tables[0])

      return this.field({ kind: 'table', table: type.tables[0] }, name)
    }

    if (type.kind === 'object' && type.fields[name]) {
      return { type: type.fields[name], owner: context.owner }
    }

    throw new ModelingException(`${context.owner} has no field ${name}`)
  }

  resolve(steps: readonly PathStep[], start: Context): Resolved {
    let element = start
    let many = false
    let optional = false

    for (const step of steps) {
      if (step.kind === 'edge') {
        const target = step.target ?? step.edge

        this.touch(step.edge)
        this.touch(target)
        element = { kind: 'table', table: target }
        many = true

        continue
      }

      const { type, owner } = this.field(element, step.name)
      let inner = type

      if (inner.kind === 'option') {
        optional = true
        inner = inner.inner
      }

      if (inner.kind === 'array' && step !== steps.at(-1)) {
        many = true
        inner = inner.inner
      }

      element = { kind: 'type', type: inner, owner }
    }

    return { element, many, optional }
  }

  render(type: FieldType): string {
    switch (type.kind) {
      case 'scalar':
        return {
          string: 'string',
          int: 'number',
          float: 'number',
          number: 'number',
          decimal: 'string',
          bool: 'boolean',
          datetime: 'Date',
          uuid: 'string',
          duration: 'string',
          bytes: 'Uint8Array',
          any: 'unknown',
        }[type.name]
      case 'record':
        return type.tables.length === 0
          ? 'string'
          : type.tables.map((table) => idTypeOf(this.schema, table)).join(' | ')
      case 'option':
        return `${this.render(type.inner)} | undefined`
      case 'array':
        return `Array<${this.render(type.inner)}>`
      case 'literal':
        return type.values.map((value) => `'${value}'`).join(' | ')
      case 'object': {
        const entries = Object.entries(type.fields)

        return entries.length === 0
          ? 'Record<string, unknown>'
          : `{ ${entries.map(([name, inner]) => this.property(name, inner)).join('; ')} }`
      }
    }
  }

  property(name: string, type: FieldType, forceOptional = false): string {
    const optional = forceOptional || type.kind === 'option'
    const text = this.render(type)

    return `${name}${optional ? '?' : ''}: ${optional && type.kind !== 'option' ? `${text} | undefined` : text}`
  }

  projection(projection: Projection, start: Context): string {
    const resolved = this.resolve(projection.expr.steps, start)
    let text: string

    if (projection.children) {
      const base = this.elementContext(resolved.element)

      text = `{ ${projection.children.map((child) => this.projection(child, base)).join('; ')} }`
    } else {
      text = this.leaf(resolved.element)
    }

    if (resolved.many) {
      return `${projection.name}: Array<${text}>`
    }

    if (resolved.optional) {
      return `${projection.name}?: ${text.endsWith('| undefined') ? text : `${text} | undefined`}`
    }

    return `${projection.name}: ${text}`
  }

  /** The context a destructuring reads from: a record becomes its table. */
  elementContext(element: Context): Context {
    if (
      element.kind === 'type' &&
      element.type.kind === 'record' &&
      element.type.tables.length === 1
    ) {
      const table = element.type.tables[0] ?? ''

      this.touch(table)

      return { kind: 'table', table }
    }

    return element
  }

  leaf(element: Context): string {
    return element.kind === 'table'
      ? idTypeOf(this.schema, element.table)
      : this.render(element.type)
  }
}

function sourceTable(ast: ShapeAst, params: readonly ParamDecl[]): string {
  if (ast.from.kind === 'table') {
    return ast.from.table
  }

  const name = ast.from.name
  const table = recordTableOf(params.find((param) => param.name === name)?.type ?? '')

  if (!table) {
    throw new ModelingException(
      `a shape reads FROM a table or a $parameter declared as record<table>; $${name} is not`,
    )
  }

  return table
}

function walk(
  ast: ShapeAst,
  params: readonly ParamDecl[],
  schema: SchemaModel,
): { walker: Walker; body: string } {
  const walker = new Walker(schema)
  const table = sourceTable(ast, params)

  walker.touch(table)

  const body = `{ ${ast.projections.map((projection) => walker.projection(projection, { kind: 'table', table })).join('; ')} }`

  return { walker, body }
}

/** The TypeScript text of a schema field type, e.g. a declared parameter type. */
export function renderFieldType(schema: SchemaModel, type: FieldType): string {
  return new Walker(schema).render(type)
}

/** The TypeScript text of the shape's result type. */
export function inferResultType(
  ast: ShapeAst,
  params: readonly ParamDecl[],
  schema: SchemaModel,
): string {
  const { body } = walk(ast, params, schema)

  return ast.from.only ? `${body} | undefined` : `Array<${body}>`
}

/** The tables a shape reads, in the order it reaches them. */
export function tablesOf(
  ast: ShapeAst,
  params: readonly ParamDecl[],
  schema: SchemaModel,
): string[] {
  return walk(ast, params, schema).walker.tables
}
