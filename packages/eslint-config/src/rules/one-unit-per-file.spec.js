import { RuleTester } from 'eslint'
import tseslint from 'typescript-eslint'
import { afterAll, describe, it } from 'vitest'

import { oneUnitPerFile } from './one-unit-per-file.js'

RuleTester.afterAll = afterAll
RuleTester.describe = describe
RuleTester.it = it

const tester = new RuleTester({ languageOptions: { parser: tseslint.parser } })

tester.run('one-unit-per-file', oneUnitPerFile, {
  valid: [
    { code: 'export function checkName(name: string): string { return name }' },
    { code: 'export class ProfileService {}\nexport const PROFILE_SERVICE = Symbol("x")' },
    {
      code: 'export const MAX = 80\nexport type Name = string\nexport interface Row { id: string }\nexport function checkName(n: string): string { return trim(n) }\nfunction trim(n: string): string { return n.trim() }',
    },
    { code: 'export { checkName } from "./name.rule"\nexport { checkBio } from "./bio.rule"' },
    { code: 'export const nameSchema = z.string()\nexport const checkName = (n: string) => n' },
    {
      code: 'export function parse(x: string): number\nexport function parse(x: number): number\nexport function parse(x: unknown): number { return Number(x) }',
    },
    { code: 'class Helper {}\nexport function make(): Helper { return new Helper() }' },
    { code: 'function a() {}\nexport { a, a as b }\nexport default a' },
    { code: 'export { a, b } from "./elsewhere"\nexport function c() {}' },
    { code: 'export const handler = (() => 1) as () => number' },
    { code: 'const local = () => 1\nexport const value = local()' },
    {
      code: 'class Helper {}\nexport type { Helper }\nexport function make() { return new Helper() }',
    },
    {
      code: 'class Helper {}\nexport { type Helper }\nexport function make() { return new Helper() }',
    },
  ],
  invalid: [
    {
      code: 'export function checkName(n: string): string { return n }\nexport function checkBio(b: string): string { return b }',
      errors: [
        { messageId: 'second', data: { kind: 'function', name: 'checkBio', first: 'checkName' } },
      ],
    },
    {
      code: 'export class ProfileService {}\nexport const profileName = (n: string) => n',
      errors: [
        {
          messageId: 'second',
          data: { kind: 'function', name: 'profileName', first: 'ProfileService' },
        },
      ],
    },
    {
      code: 'export const a = () => 1\nexport const b = function () { return 2 }\nexport class C {}',
      errors: [{ messageId: 'second' }, { messageId: 'second' }],
    },
    {
      code: 'export function a() {}\nexport default function () {}',
      errors: [{ messageId: 'second', data: { kind: 'function', name: 'default', first: 'a' } }],
    },
    {
      code: 'function a() {}\nfunction b() {}\nexport { a, b }',
      errors: [{ messageId: 'second', data: { kind: 'function', name: 'b', first: 'a' } }],
    },
    {
      code: 'export function a() {}\nconst b = () => 1\nexport default b',
      errors: [{ messageId: 'second', data: { kind: 'function', name: 'b', first: 'a' } }],
    },
    {
      code: 'export const a = (() => 1) as () => number\nexport const b = (() => 2) satisfies () => number',
      errors: [{ messageId: 'second', data: { kind: 'function', name: 'b', first: 'a' } }],
    },
    {
      code: 'export function a() {}\nconst b = () => 1\nexport default (b satisfies () => number)',
      errors: [{ messageId: 'second', data: { kind: 'function', name: 'b', first: 'a' } }],
    },
    {
      code: 'export const A = class {}\nexport const B = class {}',
      errors: [{ messageId: 'second', data: { kind: 'class', name: 'B', first: 'A' } }],
    },
  ],
})
