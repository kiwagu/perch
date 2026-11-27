/**
 * Reads the module the contract's engine emits for the roles, the routes and the invariants'
 * numbers (`ui-contract emit terms`): `CONTRACT_ROLES` and `CONTRACT_ROUTES`, each an object literal
 * of strings written as strings, and `CONTRACT_INVARIANTS`, an object literal of object literals of
 * numbers. A module that is missing, lacks a constant or holds anything else fails, never reads as
 * empty: the lint rule that reads it would pass everything.
 */

import { readFileSync } from 'node:fs'

import ts from 'typescript'

/** The object literal `name` exports in `source`, or undefined when it exports none. */
function literalOf(source, name, path) {
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

      return value
    }
  }

  return undefined
}

/** Each invariant of `CONTRACT_INVARIANTS` by its name, with its numbers by theirs. */
function invariantsOf(source, path) {
  const literal = literalOf(source, 'CONTRACT_INVARIANTS', path)

  if (literal === undefined) {
    throw new Error(`${path}: no CONTRACT_INVARIANTS; write it with \`ui-contract emit terms\``)
  }

  return new Map(
    literal.properties.map((property) => {
      if (
        !ts.isPropertyAssignment(property) ||
        !ts.isStringLiteral(property.name) ||
        !ts.isObjectLiteralExpression(property.initializer)
      ) {
        throw new Error(`${path}: an entry of CONTRACT_INVARIANTS is not an object written as one`)
      }

      return [
        property.name.text,
        new Map(
          property.initializer.properties.map((number) => {
            if (
              !ts.isPropertyAssignment(number) ||
              !ts.isStringLiteral(number.name) ||
              !ts.isNumericLiteral(number.initializer)
            ) {
              throw new Error(`${path}: a number of CONTRACT_INVARIANTS is not a number`)
            }

            return [number.name.text, Number(number.initializer.text)]
          }),
        ),
      ]
    }),
  )
}

/** The string entries of the object literal `name` exports in `source`. */
function constantOf(source, name, path) {
  const literal = literalOf(source, name, path)

  if (literal === undefined) {
    throw new Error(`${path}: no ${name}; write it with \`ui-contract emit terms\``)
  }

  return literal.properties.map((property) => {
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

const cache = new Map()

/**
 * The roles, the routes and the invariants' numbers the module at `path` holds: each role by its
 * name, each route by its path with the screen's id that names it, each invariant by its name
 * with its numbers. Read once per path and version of the file.
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
    invariants: invariantsOf(source, path),
  }

  cache.set(path, { text, terms })

  return terms
}
