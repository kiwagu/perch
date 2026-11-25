/**
 * Finds a role written in SurrealQL that the contract does not name. A role is stored as its name
 * (`membership.role`, `member.role`, `invitation.role`, `identity.role`), so a schema's assert, a
 * query and a fixture write it as a string: after the field `role` compared (`=`, `==`, `!=`), set
 * or tested against a list (`IN`, `NOT IN`, `INSIDE`), as an object's `role:`, and, in the
 * definition of a field named `role`, after `$value` compared or tested the same way. Each such
 * string is one of the contract's roles (`CONTRACT_ROLES`), or a value allowed for that field of
 * that table alone (`identity.role` holds `user`, the auth library's word for an account with no
 * platform role). A table name (`type::record('member', $id)`) and a comment are no role. A role
 * written another way (the other way round, with `CONTAINS`, as a quoted key, through a `LET`) is
 * not read: the schema and the queries write roles in the forms above.
 */

import { type Token, tokenize } from './tokenizer'

export interface RoleViolation {
  readonly path: string
  readonly line: number
  readonly rule: 'contract-roles'
  readonly text: string
}

/** The operators after which a role or a list of roles follows. */
const COMPARED = new Set(['=', '==', '!=', 'IN', 'INSIDE', 'NOTINSIDE'])

/** The words of `DEFINE FIELD` before the field's name. */
const DEFINE_WORDS = new Set(['OVERWRITE', 'IF', 'NOT', 'EXISTS'])

const lineOf = (source: string, offset: number): number =>
  source.slice(0, offset).split('\n').length

/** The value of a string token: its text without a prefix and quotes; none for `⟨…⟩`. */
const stringValue = (token: Token): string | undefined =>
  /^[rdub]?(['"])([\s\S]*)\1$/.exec(token.text)?.[2]

const isWord = (token: Token | undefined, word: string): boolean =>
  token?.kind === 'word' && token.text.toUpperCase() === word

/**
 * The index of the token after the operator that starts at `at` (`NOT IN` is one), or undefined
 * when no operator a role follows starts there.
 */
function afterOperator(tokens: readonly Token[], at: number): number | undefined {
  const token = tokens[at]

  if (isWord(token, 'NOT') && (isWord(tokens[at + 1], 'IN') || isWord(tokens[at + 1], 'INSIDE'))) {
    return at + 2
  }

  const text = token?.kind === 'word' ? token.text.toUpperCase() : token?.text

  return token !== undefined && token.kind !== 'string' && COMPARED.has(text ?? '')
    ? at + 1
    : undefined
}

/** The string tokens of a role or a list of roles that starts at `at`. */
function rolesAt(tokens: readonly Token[], at: number): Token[] {
  const first = tokens[at]

  if (first?.kind === 'string') {
    return [first]
  }

  if (first?.text !== '[') {
    return []
  }

  const listed: Token[] = []

  for (let index = at + 1; index < tokens.length && tokens[index]?.text !== ']'; index++) {
    const token = tokens[index]

    if (token?.kind === 'string') {
      listed.push(token)
    }
  }

  return listed
}

/** The table of `DEFINE FIELD … role ON [TABLE] <table>` starting at `at`, or undefined. */
function roleFieldTable(tokens: readonly Token[], at: number): string | undefined {
  if (!isWord(tokens[at], 'DEFINE') || !isWord(tokens[at + 1], 'FIELD')) {
    return undefined
  }

  let index = at + 2
  const named: string[] = []

  while (index < tokens.length && !isWord(tokens[index], 'ON') && tokens[index]?.text !== ';') {
    const token = tokens[index]

    if (!(token?.kind === 'word' && DEFINE_WORDS.has(token.text.toUpperCase()))) {
      named.push(token?.text ?? '')
    }

    index++
  }

  const table = isWord(tokens[index + 1], 'TABLE') ? tokens[index + 2] : tokens[index + 1]

  return named.join('') === 'role' && table?.kind === 'word' ? table.text : undefined
}

export function findSurqlRoles(
  path: string,
  source: string,
  roles: ReadonlySet<string>,
  allowed: ReadonlyMap<string, ReadonlySet<string>>,
): RoleViolation[] {
  const tokens = tokenize(source)
  const violations: RoleViolation[] = []
  let table: string | undefined

  tokens.forEach((token, index) => {
    if (token.text === ';') {
      table = undefined

      return
    }

    table = roleFieldTable(tokens, index) ?? table

    const isRole = token.kind === 'word' && token.text === 'role'
    const isValue = token.kind === 'param' && token.text === 'value' && table !== undefined
    const next = tokens[index + 1]

    if (!isRole && !isValue) {
      return
    }

    const at =
      isRole && next?.text === ':' && next.kind === 'punct'
        ? index + 2
        : afterOperator(tokens, index + 1)
    const fieldAllows = isValue ? allowed.get(`${table}.role`) : undefined

    for (const string of at === undefined ? [] : rolesAt(tokens, at)) {
      const value = stringValue(string)

      if (value !== undefined && !roles.has(value) && fieldAllows?.has(value) !== true) {
        violations.push({
          path,
          line: lineOf(source, string.start),
          rule: 'contract-roles',
          text: value,
        })
      }
    }
  })

  return violations
}
