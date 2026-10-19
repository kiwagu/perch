/**
 * In domain and application code a file holds one unit: one exported function or one
 * exported class, the business function or the class the file is named after. Types,
 * interfaces, constants, schemas and tokens are free, the unit's private helpers stay
 * unexported in the same file, and re-exports from other modules do not count. A second
 * exported function or class goes to a file of its own.
 *
 * A unit is counted however it is exported: a declaration, a const holding a function or
 * class (also behind `as`, `satisfies` or `!`), `export default` (wrapped or not), or a local
 * export list (`export { a, b }`); a binding exported under two names counts once, and a
 * type-only export (`export type { A }`, `export { type A }`) counts not at all.
 */

const WRAPPERS = new Set([
  'TSAsExpression',
  'TSSatisfiesExpression',
  'TSNonNullExpression',
  'TSTypeAssertion',
  'TSInstantiationExpression',
])

/** The value behind transparent TypeScript wrappers. */
function unwrap(node) {
  let current = node

  while (current && WRAPPERS.has(current.type)) {
    current = current.expression
  }

  return current
}

/** `function` or `class` when a value is one, otherwise undefined. */
function kindOfValue(node) {
  const value = unwrap(node)

  if (!value) {
    return undefined
  }

  if (value.type === 'ArrowFunctionExpression' || value.type === 'FunctionExpression') {
    return 'function'
  }

  if (value.type === 'ClassExpression') {
    return 'class'
  }

  return undefined
}

/** `function` or `class` for a declaration, otherwise undefined. */
function kindOfDeclaration(node) {
  if (node.type === 'FunctionDeclaration') {
    return 'function'
  }

  if (node.type === 'ClassDeclaration') {
    return 'class'
  }

  return undefined
}

/** Top-level local bindings that hold a function or a class, by name. */
function localUnits(program) {
  const units = new Map()

  for (const statement of program.body) {
    const declaration =
      statement.type === 'ExportNamedDeclaration' && statement.declaration
        ? statement.declaration
        : statement

    const kind = kindOfDeclaration(declaration)

    if (kind && declaration.id) {
      units.set(declaration.id.name, { node: declaration, kind })
    }

    if (declaration.type === 'VariableDeclaration') {
      for (const declarator of declaration.declarations) {
        const valueKind = kindOfValue(declarator.init)

        if (valueKind && declarator.id.type === 'Identifier') {
          units.set(declarator.id.name, { node: declarator, kind: valueKind })
        }
      }
    }
  }

  return units
}

/** The exported units of a file, each binding once, in source order. */
function exportedUnits(program) {
  const locals = localUnits(program)
  const exported = new Map()
  const add = (name, unit) => {
    if (unit && !exported.has(name)) {
      exported.set(name, { ...unit, name })
    }
  }

  for (const statement of program.body) {
    if (statement.type === 'ExportDefaultDeclaration') {
      const declaration = unwrap(statement.declaration)

      if (declaration.type === 'Identifier') {
        add(declaration.name, locals.get(declaration.name))
        continue
      }

      const kind = kindOfDeclaration(declaration) ?? kindOfValue(declaration)
      const name = declaration.id?.name ?? 'default'

      if (kind) {
        add(name, { node: statement, kind })
      }

      continue
    }

    // Type-only exports carry no runtime unit; lists from other modules are re-exports.
    if (
      statement.type !== 'ExportNamedDeclaration' ||
      statement.source ||
      statement.exportKind === 'type'
    ) {
      continue
    }

    if (statement.declaration) {
      const declaration = statement.declaration

      if (declaration.id) {
        add(declaration.id.name, locals.get(declaration.id.name))
      }

      if (declaration.type === 'VariableDeclaration') {
        for (const declarator of declaration.declarations) {
          if (declarator.id.type === 'Identifier') {
            add(declarator.id.name, locals.get(declarator.id.name))
          }
        }
      }

      continue
    }

    for (const specifier of statement.specifiers) {
      if (specifier.local.type === 'Identifier' && specifier.exportKind !== 'type') {
        add(specifier.local.name, locals.get(specifier.local.name))
      }
    }
  }

  return [...exported.values()]
}

/** @type {import('eslint').Rule.RuleModule} */
export const oneUnitPerFile = {
  meta: {
    type: 'suggestion',
    docs: {
      description: 'One exported function or class per file in domain and application code',
    },
    messages: {
      second:
        'A second unit in this file: {{kind}} `{{name}}` next to `{{first}}`. In domain and application code each business function and each class lives in a file of its own, named after it.',
    },
    schema: [],
  },
  create(context) {
    return {
      Program(program) {
        const units = exportedUnits(program)
        const first = units[0]

        for (const unit of units.slice(1)) {
          context.report({
            node: unit.node,
            messageId: 'second',
            data: { kind: unit.kind, name: unit.name, first: first?.name ?? '' },
          })
        }
      },
    }
  },
}
