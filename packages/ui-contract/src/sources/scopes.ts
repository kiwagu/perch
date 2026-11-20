/**
 * The scopes of a source file, for `bindings.ts` to bind each name in the innermost one around its
 * declaration. A `let`, a `const`, a function declaration, a parameter or a `catch` parameter binds
 * in its lexical scope: a block, a function (its parameters and body), a loop whose head declares
 * a `let`, a `const` or a `using` (a `var` binds around the loop), a `catch` clause with a
 * parameter, the block of a `switch`'s cases (after its discriminant, which is read outside: a
 * `const` in an unbraced `case` binds in every case and nowhere past the switch), a class `static`
 * block and a namespace's body. A `var` binds in the innermost function body, class `static` block
 * or namespace body around it, whatever block, case, loop or `catch` it is written in; a default of
 * a parameter does not see it. What a namespace's body exports is bound in each other body of that
 * namespace, and of one inside it, in the same scope (`namespace A { export … }` in `namespace A`
 * and `namespace A.B`), as one declaration of a namespace sees what another exports.
 */

import type {
  ForStatementInit,
  ForStatementLeft,
  Program,
  TSModuleDeclaration,
  TSTypeName,
} from 'oxc-parser'
import { Visitor } from 'oxc-parser'

/** A range of the source, `[start, end)`. */
export interface Span {
  readonly start: number
  readonly end: number
}

export const FILE: Span = { start: 0, end: Number.POSITIVE_INFINITY }

export const contains = (outer: Span, inner: Span): boolean =>
  outer.start <= inner.start && inner.end <= outer.end

export const sizeOf = ({ start, end }: Span): number => end - start

/** The innermost of `scopes` around a place, not the place itself; the file around everything. */
export const scopeAround = (at: Span, scopes: readonly Span[]): Span =>
  scopes
    .filter((scope) => contains(scope, at) && (scope.start !== at.start || scope.end !== at.end))
    .reduce((inner, scope) => (sizeOf(scope) < sizeOf(inner) ? scope : inner), FILE)

/** The scopes of a file but the file itself, each in no particular order. */
export interface Scopes {
  /** Where a `let`, a `const`, a function declaration or a parameter binds. */
  readonly lexical: readonly Span[]
  /** Where a `var` binds: a function's body, a class `static` block, a namespace's body. */
  readonly hoisting: readonly Span[]
  /** The other bodies a declaration a namespace's body exports, starting at `start`, binds in. */
  sharedAt(start: number): readonly Span[]
}

/** The names of a namespace as written, `A.B` for `namespace A.B`; none for a module's string. */
const pathOf = (id: TSModuleDeclaration['id'] | TSTypeName): string[] | undefined => {
  switch (id.type) {
    case 'Identifier':
      return [id.name]
    case 'TSQualifiedName': {
      const left = pathOf(id.left)

      return left === undefined ? undefined : [...left, id.right.name]
    }
    default:
      return undefined
  }
}

export function scopesIn(program: Program): Scopes {
  const lexical: Span[] = []
  const hoisting: Span[] = []
  /** Each namespace's body, with its declaration and its names, outermost first. */
  const namespaces: Array<{
    readonly body: Span
    readonly declaration: Span
    readonly path?: string[]
  }> = []
  /** Where each declaration a namespace's body exports starts, with that body. */
  const exported = new Map<number, Span>()
  const both = (node: Span): void => {
    lexical.push(node)
    hoisting.push(node)
  }
  const fn = (node: Span & { readonly body: (Span & { readonly type: string }) | null }): void => {
    lexical.push(node)

    if (node.body?.type === 'BlockStatement') {
      hoisting.push(node.body)
    }
  }
  const loop = (node: Span, head: ForStatementInit | ForStatementLeft | null): void => {
    if (head?.type === 'VariableDeclaration' && head.kind !== 'var') {
      lexical.push(node)
    }
  }

  new Visitor({
    BlockStatement: (node) => {
      lexical.push(node)
    },
    StaticBlock: both,
    ArrowFunctionExpression: fn,
    FunctionExpression: fn,
    FunctionDeclaration: fn,
    ForStatement: (node) => {
      loop(node, node.init)
    },
    ForInStatement: (node) => {
      loop(node, node.left)
    },
    ForOfStatement: (node) => {
      loop(node, node.left)
    },
    CatchClause: (node) => {
      if (node.param !== null) {
        lexical.push(node)
      }
    },
    SwitchStatement: (node) => {
      lexical.push({ start: node.discriminant.end, end: node.end })
    },
    TSModuleDeclaration: (node) => {
      const path = node.kind === 'global' ? undefined : pathOf(node.id)

      if (node.body?.type === 'TSModuleBlock') {
        namespaces.push({
          body: node.body,
          declaration: node,
          ...(path === undefined ? {} : { path }),
        })
      }
    },
    TSModuleBlock: (node) => {
      both(node)

      for (const statement of node.body) {
        const declaration =
          statement.type === 'ExportNamedDeclaration' ? statement.declaration : null

        if (declaration?.type === 'VariableDeclaration') {
          for (const declarator of declaration.declarations) {
            exported.set(declarator.start, node)
          }
        } else if (declaration?.type === 'FunctionDeclaration') {
          exported.set(declaration.start, node)
        }
      }
    },
  }).visit(program)

  /**
   * Where each namespace's body is: the scope its outermost namespace is declared in, and the names
   * down to it, a body declared in another's adding its names to that one's.
   */
  const placed = new Map<Span, { readonly root: Span; readonly path: readonly string[] }>()

  for (const { body, declaration, path } of namespaces) {
    const around = scopeAround(declaration, lexical)
    const outer = placed.get(around)

    if (path !== undefined) {
      placed.set(
        body,
        outer === undefined
          ? { root: around, path }
          : { root: outer.root, path: [...outer.path, ...path] },
      )
    }
  }

  return {
    lexical,
    hoisting,
    sharedAt: (start) => {
      const from = exported.get(start)
      const at = from === undefined ? undefined : placed.get(from)

      return at === undefined
        ? []
        : [...placed]
            .filter(
              ([body, { root, path }]) =>
                body !== from &&
                root === at.root &&
                at.path.every((name, index) => path[index] === name),
            )
            .map(([body]) => body)
    },
  }
}
