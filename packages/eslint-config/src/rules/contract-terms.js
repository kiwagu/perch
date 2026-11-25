/**
 * Reports a role or a route of the UI contract written by hand as a string where the code expects
 * a role or a route: code and tests name them through `CONTRACT_ROLES` and `CONTRACT_ROUTES`, the
 * constants the contract's engine emits (`ui-contract emit terms`), so a role or a route is said
 * once, in the contract. The option `module` is the absolute path of that module; the rule reads
 * its two constants (a missing or malformed module fails the lint, never passes it).
 *
 * The code expects a role where TypeScript does: the type the code declares at the literal (a
 * parameter, an element of a typed list, a typed property or return; never a type inferred from
 * the literal itself, and a type parameter by its constraint), the declared type of the other side
 * of `===`, `!==`, `==` or `!=`, or of the discriminant of the `switch` a `case` tests (never as
 * the flow narrowed it), is made of string literal types that are all roles of the contract
 * (`undefined` and `null` aside). A property's value is read across every member of the union its
 * object is expected to be, so a discriminant shared with other kinds is no role. A property key,
 * quoted or written as a name, of an object whose expected keys are all roles is one too. Routes are found the same way. Role names are common words (`identity` and `member`
 * are tables too) and `/devices` is also a gateway API path, so a string elsewhere is left alone.
 * Type annotations are not read: a type is held by the compiler once it derives from the
 * constants.
 *
 * With `routeValues: true` (where no other kind of path is written, the e2e tests: Playwright's
 * `goto` takes any string) every string naming a route by its value is reported too: a string
 * literal that is a route, or a route followed by `?` or `#`; a part of a template literal that
 * starts so; a regular expression that names a route ending there (`/\/me$/`). A sub-path
 * (`/settings/x`) and a longer word (`/settingsx`) are not routes. Needs type information
 * (typescript-eslint `projectService`); without it the rule fails rather than pass in silence.
 *
 * A number of an invariant (`CONTRACT_INVARIANTS`) is reported where the code expects a property
 * the module itself declares: an object's property whose declared type is an invariant's numbers,
 * whole or picked (`Pick<…>` keeps the declaration), written as the number the module holds there.
 * Numbers are common, so only that declaration says the code expects one of the contract's; a
 * literal type of the code's own (`status: 200`) says nothing, and a number the module does not
 * hold there is the compiler's to refuse.
 */

import { resolve } from 'node:path'

import ts from 'typescript'

import { readContractTerms } from './contract-terms-module.js'
import { typeReaders } from './contract-terms-types.js'
import { routeInPattern, routeNamedBy, routeStartingQuasi } from './route-values.js'

export { readContractTerms } from './contract-terms-module.js'

const IDENTIFIER = /^[A-Za-z_$][\w$]*$/

/** Whether `values` names something, and every value of it is a key of `known`. */
const within = (values, known) =>
  values !== undefined && values.length > 0 && values.every((value) => known.has(value))

/** How the constant names `key`: `NAME.key`, or `NAME["key"]` for a key that is no identifier. */
const access = (name, key) =>
  IDENTIFIER.test(key) ? `${name}.${key}` : `${name}[${JSON.stringify(key)}]`

/** @type {import('eslint').Rule.RuleModule} */
export const contractTerms = {
  meta: {
    type: 'problem',
    docs: {
      description: 'Disallow a role or a route of the UI contract written by hand',
    },
    messages: {
      role: '"{{value}}" is a role of the contract written by hand: name it {{name}}, from the module the contract emits.',
      route:
        '"{{value}}" names a route of the contract by hand: name it {{name}}, from the module the contract emits.',
      number:
        '{{value}} is a number of the contract written by hand: name it {{name}}, from the module the contract emits.',
    },
    schema: [
      {
        type: 'object',
        properties: { module: { type: 'string' }, routeValues: { type: 'boolean' } },
        required: ['module'],
        additionalProperties: false,
      },
    ],
  },
  create(context) {
    const [{ module, routeValues = false }] = context.options
    const { roles, routes, invariants } = readContractTerms(module)
    const emitted = resolve(module)
    const services = context.sourceCode.parserServices

    if (!services?.program || !services.esTreeNodeToTSNodeMap) {
      throw new Error('workspace/contract-terms needs type information (projectService)')
    }

    const { expectedAt, expectedKeys } = typeReaders(services, { roles, routes })

    function reportRole(node, value) {
      context.report({
        node,
        messageId: 'role',
        data: { value, name: access('CONTRACT_ROLES', value) },
      })
    }

    function reportRoute(node, value) {
      context.report({
        node,
        messageId: 'route',
        data: { value, name: access('CONTRACT_ROUTES', routes.get(value)) },
      })
    }

    /** Reports the string `value` at `node` when the code expects a role or a route there. */
    function checkExpected(node, value, values) {
      if (values === undefined) {
        return
      }

      if (within(values, roles) && roles.has(value)) {
        reportRole(node, value)
      } else if (within(values, routes) && routes.has(value)) {
        reportRoute(node, value)
      }
    }

    /**
     * The invariant whose number the module declares at `property`, the declaration of a property
     * the code expects: `"limit": 10` under `"failed-sign-ins"`; none for a declaration elsewhere.
     */
    function invariantDeclaring(property) {
      const declaration = (property?.getDeclarations() ?? []).find(
        (each) => resolve(each.getSourceFile().fileName) === emitted,
      )
      const holder = declaration?.parent?.parent

      return holder !== undefined &&
        ts.isPropertyAssignment(holder) &&
        ts.isStringLiteral(holder.name)
        ? holder.name.text
        : undefined
    }

    /** Reports the number `node` where the code expects a number the module declares, as it. */
    function checkNumber(node) {
      const { parent } = node

      if (
        parent?.type !== 'Property' ||
        parent.value !== node ||
        parent.parent?.type !== 'ObjectExpression'
      ) {
        return
      }

      const name =
        parent.key.type === 'Identifier' && !parent.computed
          ? parent.key.name
          : typeof parent.key.value === 'string'
            ? parent.key.value
            : undefined
      const object = services.program
        .getTypeChecker()
        .getContextualType(
          services.esTreeNodeToTSNodeMap.get(parent.parent),
          ts.ContextFlags.IgnoreNodeInferences,
        )

      if (name === undefined || object === undefined) {
        return
      }

      for (const member of object.isUnion() ? object.types : [object]) {
        const invariant = invariantDeclaring(
          services.program.getTypeChecker().getPropertyOfType(member, name),
        )

        if (invariant !== undefined && invariants.get(invariant)?.get(name) === node.value) {
          context.report({
            node,
            messageId: 'number',
            data: {
              value: String(node.value),
              name: `${access('CONTRACT_INVARIANTS', invariant)}.${name}`,
            },
          })

          return
        }
      }
    }

    function checkString(node, value) {
      const { parent } = node

      if (parent?.type === 'TSLiteralType' || parent?.type === 'ImportDeclaration') {
        return
      }

      if (routeValues) {
        const route = routeNamedBy(value, routes)

        if (route !== undefined) {
          reportRoute(node, route)

          return
        }
      }

      if (parent?.type === 'Property' && parent.key === node) {
        checkExpected(node, value, expectedKeys(parent.parent))

        return
      }

      checkExpected(node, value, expectedAt(node))
    }

    return {
      Property(node) {
        // A key written as a name (`{ operator: … }`, or `{ member }` with a variable of that name)
        // is a role as much as a quoted one.
        if (
          node.key.type === 'Identifier' &&
          !node.computed &&
          node.kind === 'init' &&
          node.parent?.type === 'ObjectExpression'
        ) {
          checkExpected(node.key, node.key.name, expectedKeys(node.parent))
        }
      },
      Literal(node) {
        if (typeof node.value === 'number') {
          checkNumber(node)
        } else if (typeof node.value === 'string') {
          checkString(node, node.value)
        } else if (routeValues && node.regex !== undefined) {
          const route = routeInPattern(node.regex.pattern, routes)

          if (route !== undefined) {
            reportRoute(node, route)
          }
        }
      },
      TemplateLiteral(node) {
        if (node.parent?.type === 'TaggedTemplateExpression') {
          return
        }

        if (node.expressions.length === 0) {
          checkString(node, node.quasis[0]?.value.cooked ?? '')

          return
        }

        if (!routeValues) {
          return
        }

        for (const quasi of node.quasis) {
          const route = routeStartingQuasi(quasi.value.cooked ?? '', routes)

          if (route !== undefined) {
            reportRoute(node, route)

            return
          }
        }
      },
    }
  },
}
