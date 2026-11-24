/**
 * Reads the module the contract's engine emits for the roles and the routes
 * (`ui-contract emit terms`): its two constants, `CONTRACT_ROLES` and `CONTRACT_ROUTES`, each an
 * object literal of strings written as strings. A module that is missing, lacks a constant or
 * holds anything else fails, never reads as empty: the lint rule that reads it would pass
 * everything.
 */

import { readFileSync } from 'node:fs'

import ts from 'typescript'

/** The string entries of the object literal `name` exports in `source`. */
function constantOf(source, name, path) {
  for (const statement of source.statements) {
    if (!ts.isVariableStatement(statement)) {
      continue
    }

    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name) || declaration.name.text !== name) {
        continue
      }

      const value =
        declaration.initializer !== undefined && ts.isAsExpression(declaration.initializer)
          ? declaration.initializer.expression
          : declaration.initializer

      if (value === undefined || !ts.isObjectLiteralExpression(value)) {
        throw new Error(`${path}: ${name} is not an object literal`)
      }

      return value.properties.map((property) => {
        if (
          !ts.isPropertyAssignment(property) ||
          !ts.isStringLiteral(property.name) ||
          !ts.isStringLiteral(property.initializer)
        ) {
          throw new Error(`${path}: an entry of ${name} is not a string written as a string`)
        }

        return [property.name.text, property.initializer.text]
      })
    }
  }

  throw new Error(`${path}: no ${name}; write it with \`ui-contract emit terms\``)
}

const cache = new Map()

/**
 * The roles and the routes the module at `path` holds: each role by its name, each route by its
 * path with the screen's id that names it. Read once per path and version of the file.
 */
export function readContractTerms(path) {
  let text

  try {
    text = readFileSync(path, 'utf8')
  } catch {
    throw new Error(`${path}: no such module; write it with \`ui-contract emit terms\``)
  }

  const cached = cache.get(path)

  if (cached?.text === text) {
    return cached.terms
  }

  const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, false, ts.ScriptKind.TS)
  const terms = {
    roles: new Map(constantOf(source, 'CONTRACT_ROLES', path).map(([, role]) => [role, role])),
    routes: new Map(constantOf(source, 'CONTRACT_ROUTES', path).map(([id, route]) => [route, id])),
  }

  cache.set(path, { text, terms })

  return terms
}
