/**
 * What a source file's type declarations say of a type it writes, as far as the file itself says,
 * for the type of a spread `asked-event.ts` cannot follow (`Locals.declaredTypeOf`): the type of a
 * key in an object type, whether a value of a type cannot carry a key, and whether it can. An
 * object type is a type literal or an interface, its own members and those of each interface or
 * alias it extends, read only where every member is a property or a method whose key the file
 * states (no index, call or construct signature); `canCarry` needs less, since one member that is
 * the key, a string index signature or a key the file cannot read shows a type may carry it
 * (`member-key.ts`), whatever else the type extends. A name stands for an interface or an alias
 * only where the file declares it once, at its top, with no type parameters, and nothing else of
 * the file binds that name as a type (a type parameter, an import, a class, an enum, a namespace, a
 * declaration in a block); and only in a module (an `import` or an `export`), since a script's
 * declarations are global and may merge with others. Anything else, an import, a generic, a mapped
 * or utility type, `Record`, `any`, `unknown`, a type argument or a chain past `DEPTH`, the file
 * does not say, so it cannot be told.
 */

import type {
  Program,
  TSInterfaceDeclaration,
  TSInterfaceHeritage,
  TSSignature,
  TSType,
  TSTypeAliasDeclaration,
} from 'oxc-parser'
import { Visitor } from 'oxc-parser'

import { DEPTH } from './alternatives'
import { mayBeKey } from './member-key'
import { keyName } from './values'

export interface DeclaredTypes {
  /** The type the file writes for `key` in an object type, where one member has it: none else. */
  memberOf(type: TSType, key: string): TSType | undefined
  /**
   * Whether a value of `type` cannot carry `key`: an object type without it, a union or an
   * intersection of such types, `undefined` or `null` (whose spread supplies nothing).
   */
  cannotCarry(type: TSType, key: string): boolean
  /**
   * Whether the file shows a value of `type` may carry `key`: an object type with a member of that
   * name, a string index signature or a key the file cannot read, or a union or an intersection of
   * which one type does. A type it cannot tell (an import, a generic, `any`) is none that shows it.
   */
  canCarry(type: TSType, key: string): boolean
}

type Declaration = TSInterfaceDeclaration | TSTypeAliasDeclaration

/** The statements of a module: a file with one is no script. */
const MODULE = new Set([
  'ImportDeclaration',
  'ExportNamedDeclaration',
  'ExportDefaultDeclaration',
  'ExportAllDeclaration',
  'TSExportAssignment',
])

export function declaredTypesIn(program: Program): DeclaredTypes {
  /** How many times the file binds each name as a type, anywhere. */
  const bound = new Map<string, number>()
  const bind = (name: string): void => {
    bound.set(name, (bound.get(name) ?? 0) + 1)
  }
  const named = (node: { readonly id: { readonly name: string } | null }): void => {
    if (node.id !== null) {
      bind(node.id.name)
    }
  }

  new Visitor({
    TSInterfaceDeclaration: named,
    TSTypeAliasDeclaration: named,
    TSEnumDeclaration: named,
    ClassDeclaration: named,
    ClassExpression: named,
    TSImportEqualsDeclaration: named,
    TSModuleDeclaration: (node) => {
      if (node.id.type === 'Identifier') {
        bind(node.id.name)
      }
    },
    TSTypeParameter: (node) => {
      bind(node.name.name)
    },
    TSMappedType: (node) => {
      bind(node.key.name)
    },
    ImportSpecifier: (node) => {
      bind(node.local.name)
    },
    ImportDefaultSpecifier: (node) => {
      bind(node.local.name)
    },
    ImportNamespaceSpecifier: (node) => {
      bind(node.local.name)
    },
  }).visit(program)

  /** The interfaces and aliases the file declares at its top, exported or not, in a module. */
  const top = new Map<string, Declaration>()

  if (program.body.some((statement) => MODULE.has(statement.type))) {
    for (const statement of program.body) {
      const declaration =
        statement.type === 'ExportNamedDeclaration' || statement.type === 'ExportDefaultDeclaration'
          ? statement.declaration
          : statement

      if (
        declaration?.type === 'TSInterfaceDeclaration' ||
        declaration?.type === 'TSTypeAliasDeclaration'
      ) {
        top.set(declaration.id.name, declaration)
      }
    }
  }

  /** The interface or the alias a name stands for, where the file says so for certain. */
  const declarationNamed = (name: string): Declaration | undefined => {
    const declaration = top.get(name)

    return bound.get(name) === 1 && declaration?.typeParameters === null ? declaration : undefined
  }

  /** The declaration a reference names: a bare name, no type arguments. */
  const referenced = (type: TSType): Declaration | undefined =>
    type.type === 'TSTypeReference' &&
    type.typeName.type === 'Identifier' &&
    type.typeArguments === null
      ? declarationNamed(type.typeName.name)
      : undefined

  /** Members whose keys the file states, properties and methods only: none else are read. */
  const plain = (members: readonly TSSignature[]): boolean =>
    members.every(
      (member) =>
        (member.type === 'TSPropertySignature' || member.type === 'TSMethodSignature') &&
        keyName(member.key, member.computed) !== undefined,
    )

  /** The interface or the alias an `extends` names: a bare name, no type arguments. */
  const baseOf = (heritage: TSInterfaceHeritage): Declaration | undefined =>
    heritage.expression.type === 'Identifier' && heritage.typeArguments === null
      ? declarationNamed(heritage.expression.name)
      : undefined

  /** Every member of an interface: its own, then those of each interface or alias it extends. */
  const interfaceMembers = (
    declaration: TSInterfaceDeclaration,
    depth: number,
  ): TSSignature[] | undefined => {
    const own = declaration.body.body

    if (!plain(own)) {
      return undefined
    }

    const bases = declaration.extends.map((heritage) => {
      const base = baseOf(heritage)

      return base === undefined ? undefined : declarationMembers(base, depth + 1)
    })

    return bases.every((members) => members !== undefined) ? [...own, ...bases.flat()] : undefined
  }

  const declarationMembers = (
    declaration: Declaration,
    depth: number,
  ): TSSignature[] | undefined =>
    depth >= DEPTH
      ? undefined
      : declaration.type === 'TSInterfaceDeclaration'
        ? interfaceMembers(declaration, depth)
        : membersOf(declaration.typeAnnotation, depth + 1)

  /** Every member of an object type the file declares, where it can read them all. */
  const membersOf = (type: TSType, depth: number): TSSignature[] | undefined => {
    if (depth >= DEPTH) {
      return undefined
    }

    if (type.type === 'TSParenthesizedType') {
      return membersOf(type.typeAnnotation, depth + 1)
    }

    if (type.type === 'TSTypeLiteral') {
      return plain(type.members) ? type.members : undefined
    }

    const declaration = referenced(type)

    return declaration === undefined ? undefined : declarationMembers(declaration, depth + 1)
  }

  /** The key a member of a plain object type has. */
  const keyOf = (member: TSSignature): string | undefined =>
    member.type === 'TSPropertySignature' || member.type === 'TSMethodSignature'
      ? keyName(member.key, member.computed)
      : undefined

  const cannotCarry = (type: TSType, key: string, depth: number): boolean => {
    if (depth >= DEPTH) {
      return false
    }

    switch (type.type) {
      case 'TSUndefinedKeyword':
      case 'TSNullKeyword':
        return true
      case 'TSParenthesizedType':
        return cannotCarry(type.typeAnnotation, key, depth + 1)
      case 'TSUnionType':
      case 'TSIntersectionType':
        return type.types.every((member) => cannotCarry(member, key, depth + 1))
      default: {
        const declaration = referenced(type)

        if (declaration?.type === 'TSTypeAliasDeclaration') {
          return cannotCarry(declaration.typeAnnotation, key, depth + 1)
        }

        const members = membersOf(type, depth + 1)

        return members?.every((member) => keyOf(member) !== key) === true
      }
    }
  }

  /** Whether an interface or an alias may carry `key`: by its own members, or a base's. */
  const declarationCarries = (declaration: Declaration, key: string, depth: number): boolean => {
    if (depth >= DEPTH) {
      return false
    }

    if (declaration.type === 'TSTypeAliasDeclaration') {
      return canCarry(declaration.typeAnnotation, key, depth + 1)
    }

    return (
      declaration.body.body.some((member) => mayBeKey(member, key)) ||
      declaration.extends.some((heritage) => {
        const base = baseOf(heritage)

        return base !== undefined && declarationCarries(base, key, depth + 1)
      })
    )
  }

  const canCarry = (type: TSType, key: string, depth: number): boolean => {
    if (depth >= DEPTH) {
      return false
    }

    switch (type.type) {
      case 'TSParenthesizedType':
        return canCarry(type.typeAnnotation, key, depth + 1)
      case 'TSUnionType':
      case 'TSIntersectionType':
        return type.types.some((member) => canCarry(member, key, depth + 1))
      case 'TSTypeLiteral':
        return type.members.some((member) => mayBeKey(member, key))
      default: {
        const declaration = referenced(type)

        return declaration !== undefined && declarationCarries(declaration, key, depth + 1)
      }
    }
  }

  return {
    memberOf: (type, key) => {
      const [member, ...more] = (membersOf(type, 0) ?? []).filter((each) => keyOf(each) === key)

      return member?.type === 'TSPropertySignature' && more.length === 0
        ? (member.typeAnnotation?.typeAnnotation ?? undefined)
        : undefined
    },
    cannotCarry: (type, key) => cannotCarry(type, key, 0),
    canCarry: (type, key) => canCarry(type, key, 0),
  }
}
