import { RuleTester } from 'eslint'
import tseslint from 'typescript-eslint'
import { afterAll, describe, it } from 'vitest'

import { mustUseResult } from './must-use-result.js'

RuleTester.afterAll = afterAll
RuleTester.describe = describe
RuleTester.it = it

const tester = new RuleTester({
  languageOptions: {
    parser: tseslint.parser,
    parserOptions: {
      projectService: { allowDefaultProject: ['*.ts'] },
      tsconfigRootDir: import.meta.dirname,
    },
  },
})

const prelude = `import { err, ok, okAsync, type Result, ResultAsync } from 'neverthrow'
declare function save(): Result<number, string>
declare function load(): ResultAsync<number, string>
`

tester.run('must-use-result', mustUseResult, {
  valid: [
    { filename: 'fixture.ts', code: `${prelude}const r = save()` },
    { filename: 'fixture.ts', code: `${prelude}export const f = () => load()` },
    { filename: 'fixture.ts', code: `${prelude}save().match(() => 1, () => 2)` },
    { filename: 'fixture.ts', code: `${prelude}console.log(ok(1).isOk())` },
  ],
  invalid: [
    {
      filename: 'fixture.ts',
      code: `${prelude}save()`,
      errors: [{ messageId: 'unused' }],
    },
    {
      filename: 'fixture.ts',
      code: `${prelude}ok(1)`,
      errors: [{ messageId: 'unused' }],
    },
    {
      filename: 'fixture.ts',
      code: `${prelude}err('x')`,
      errors: [{ messageId: 'unused' }],
    },
    {
      filename: 'fixture.ts',
      code: `${prelude}load()`,
      errors: [{ messageId: 'unused' }],
    },
    {
      filename: 'fixture.ts',
      code: `${prelude}async function f() {\n  await okAsync(1)\n}`,
      errors: [{ messageId: 'unused' }],
    },
  ],
})
