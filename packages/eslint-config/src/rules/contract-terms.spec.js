import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { RuleTester } from 'eslint'
import tseslint from 'typescript-eslint'
import { afterAll, describe, expect, it } from 'vitest'

import { contractTerms, readContractTerms } from './contract-terms.js'

RuleTester.afterAll = afterAll
RuleTester.describe = describe
RuleTester.it = it

const MODULE = new URL('../__fixtures__/contract-terms.gen.ts', import.meta.url).pathname

const tester = new RuleTester({
  languageOptions: {
    parser: tseslint.parser,
    parserOptions: {
      projectService: { allowDefaultProject: ['*.ts'] },
      tsconfigRootDir: import.meta.dirname,
    },
  },
})

const prelude = `type Role = 'admin' | 'guest' | 'identity' | 'member' | 'operator'
type PlatformRole = 'operator'
type Route = '/console/account' | '/$' | '/me' | '/settings'
declare const ROLES: { readonly operator: 'operator'; readonly member: 'member' }
declare function grant(role: Role): void
declare function holds(roles: readonly Role[]): void
declare function open(path: Route): void
declare function fetchJson(path: string): void
declare const role: Role
declare const id: string
declare const page: { goto(url: string): Promise<void>; url(): string }
`

const typed = (code) => ({
  filename: 'fixture.ts',
  code: `${prelude}${code}`,
  options: [{ module: MODULE }],
})
const byValue = (code) => ({
  filename: 'fixture.ts',
  code: `${prelude}${code}`,
  options: [{ module: MODULE, routeValues: true }],
})
const role = (value, name = `CONTRACT_ROLES.${value}`) => ({
  messageId: 'role',
  data: { value, name },
})
const route = (value, id) => ({
  messageId: 'route',
  data: { value, name: `CONTRACT_ROUTES[${JSON.stringify(id)}]` },
})

tester.run('contract-terms', contractTerms, {
  valid: [
    typed('grant(ROLES.operator)'),
    typed("const table: string = 'identity'"),
    typed("const word = 'admin'"),
    typed("type Kind = 'identity' | 'profile'\nconst kind: Kind = 'identity'"),
    typed("declare const text: string\nexport const same = text === 'operator'"),
    typed("fetchJson('/devices')"),
    typed("fetchJson('/settings')"),
    typed("void page.goto('/settings')"),
    typed('export const told = `role ${role}`'),
    typed("const titles: Record<string, string> = { '/me': 'Profile' }"),
    typed(
      "declare const profile: { set<K extends 'identity' | 'name'>(key: K, value: string): void }\nprofile.set('identity', 'idn_1')",
    ),
    typed(
      "type Target = { kind: 'member'; key: string } | { kind: 'members'; key: string }\ndeclare const key: string\nexport const target = (): Target => ({ kind: 'member', key })",
    ),
    typed(
      "type Filter = { identity: string }\ndeclare function read(filter: Partial<Filter>): void\nread({ identity: 'idn_1' })\nread({ ['identity']: 'idn_2' })",
    ),
    typed(
      "type Target = { kind: 'member'; key: string } | { kind: 'members'; key: string }\ndeclare const target: Target\nif (target.kind === 'member') {\n  console.log(target['kind'] === 'member')\n  switch (target['kind']) {\n    case 'member':\n      break\n  }\n}",
    ),
    typed(
      "declare function read(filter: { identity: string }): void\nread({ identity: 'idn_1' })\nread({ 'identity': 'idn_2' })",
    ),
    typed('const flags: Record<string, boolean> = { operator: true }'),
    typed(
      'declare const member: boolean\nexport const shorthand: Partial<Record<Role, boolean>> = { member }',
    ),
    typed(
      "type Target = { kind: 'member'; key: string } | { kind: 'members'; key: string }\ndeclare const target: Target\nif (target.kind !== 'members') {\n  console.log(target.kind === 'member')\n}\nswitch (target.kind) {\n  case 'member':\n    break\n}",
    ),
    byValue("void page.goto('/settings/x')"),
    byValue("void page.goto('/settingsx')"),
    byValue("void page.goto('/')"),
    byValue("const word = 'settings'"),
    byValue('export const sub = /\\/me\\/x/'),
    byValue("fetchJson('/organisations')"),
    byValue("const splat = '/$x'"),
  ],
  invalid: [
    { ...typed("grant('operator')"), errors: [role('operator')] },
    { ...typed("holds(['member', 'admin'])"), errors: [role('member'), role('admin')] },
    { ...typed("const platform: PlatformRole = 'operator'"), errors: [role('operator')] },
    {
      ...typed("export const a = role === 'admin'\nexport const b = 'guest' !== role"),
      errors: [role('admin'), role('guest')],
    },
    { ...typed("switch (role) {\n  case 'guest':\n    break\n}"), errors: [role('guest')] },
    {
      ...typed("function f<R extends Role>(held: R): R {\n  return held\n}\nf('identity')"),
      errors: [role('identity')],
    },
    { ...typed("function g(): Role {\n  return 'guest'\n}"), errors: [role('guest')] },
    { ...typed('grant(`member`)'), errors: [role('member')] },
    { ...typed("const held: Role | undefined = 'member'"), errors: [role('member')] },
    {
      ...typed("open('/settings')\nconst home: Route = '/me'"),
      errors: [route('/settings', 'user.settings'), route('/me', 'user.profile')],
    },
    {
      ...typed(
        "const titles: Record<Route, string> = { '/me': 'Profile', '/settings': 'Settings', '/console/account': 'Account', '/$': 'Missing' }",
      ),
      errors: [
        route('/me', 'user.profile'),
        route('/settings', 'user.settings'),
        route('/console/account', 'console.account'),
        route('/$', 'not-found'),
      ],
    },
    {
      ...typed(
        "const granted: Partial<Record<Role, boolean>> = { operator: true, 'member': false }",
      ),
      errors: [role('operator'), role('member')],
    },
    {
      ...typed(
        "const keyed: Partial<Record<Role, boolean>> = { ['member']: true, [`admin`]: false }\ndeclare const role: Role\nexport const held = { a: role }['a'] === 'guest'",
      ),
      errors: [role('member'), role('admin'), role('guest')],
    },
    {
      ...typed(
        "declare const holder: { role: Role }\nexport const isAdmin = holder['role'] === 'admin'",
      ),
      errors: [role('admin')],
    },
    {
      ...typed(
        "declare const held: Role\nif (held !== 'guest') {\n  console.log(held === 'admin')\n}",
      ),
      errors: [role('guest'), role('admin')],
    },
    {
      ...byValue(
        "void page.goto('/settings')\nvoid page.goto('/console/account?id=1')\nvoid page.goto(`/console/account?id=${id}`)\nexport const top = '/me#top'",
      ),
      errors: [
        route('/settings', 'user.settings'),
        route('/console/account', 'console.account'),
        route('/console/account', 'console.account'),
        route('/me', 'user.profile'),
      ],
    },
    {
      ...byValue("void page.goto('/console/card?id=1')"),
      errors: [route('/console/card', 'console.account@2')],
    },
    {
      ...byValue(
        'declare const origin: string\nexport const at = `${origin}/me`\nexport const done = /\\/me$/\nexport const either = /^\\/settings(\\?|$)/',
      ),
      errors: [
        route('/me', 'user.profile'),
        route('/me', 'user.profile'),
        route('/settings', 'user.settings'),
      ],
    },
    {
      ...byValue("const pages = { '/settings': 1 }\nconst notFound = '/$'"),
      errors: [route('/settings', 'user.settings'), route('/$', 'not-found')],
    },
  ],
})

describe('readContractTerms', () => {
  const folder = mkdtempSync(join(tmpdir(), 'contract-terms-'))
  const written = (name, text) => {
    const path = join(folder, name)

    writeFileSync(path, text)

    return path
  }

  afterAll(() => rmSync(folder, { recursive: true, force: true }))

  it('reads each role by its name and each route with the id of its screen', () => {
    const { roles, routes } = readContractTerms(MODULE)

    expect([...roles.keys()]).toEqual(['admin', 'guest', 'identity', 'member', 'operator'])
    expect(routes.get('/settings')).toBe('user.settings')
  })
  it('fails on a module that is not there, lacks a constant or holds anything but strings', () => {
    expect(() => readContractTerms(join(folder, 'none.ts'))).toThrow('no such module')
    expect(() =>
      readContractTerms(
        written('roles-only.ts', 'export const CONTRACT_ROLES = { "a": "a" } as const\n'),
      ),
    ).toThrow('no CONTRACT_ROUTES')
    expect(() =>
      readContractTerms(
        written(
          'numbers.ts',
          'export const CONTRACT_ROLES = { "a": 1 } as const\nexport const CONTRACT_ROUTES = {} as const\n',
        ),
      ),
    ).toThrow('an entry of CONTRACT_ROLES is not a string')
  })
  it('reads a module again once it changed', () => {
    const path = written(
      'changing.ts',
      'export const CONTRACT_ROLES = { "a": "a" } as const\nexport const CONTRACT_ROUTES = {} as const\n',
    )

    expect([...readContractTerms(path).roles.keys()]).toEqual(['a'])

    writeFileSync(
      path,
      'export const CONTRACT_ROLES = { "b": "b" } as const\nexport const CONTRACT_ROUTES = {} as const\n',
    )

    expect([...readContractTerms(path).roles.keys()]).toEqual(['b'])
  })
})
