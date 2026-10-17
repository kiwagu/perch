import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { beforeEach, describe, expect, it } from 'vitest'

import { runModel } from './run-model'

const schemaSource = new URL('../../../database/schema/', import.meta.url).pathname
const page = 'features/user/presentation/pages/profile'

let base: string
let options: { root: string; schemaDir: string; suitesDir: string }

// The same layout as the repository: an app's sources beside the database workspace.
beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), 'model-cli-'))
  options = {
    root: join(base, 'apps/web/src'),
    schemaDir: join(base, 'database/schema'),
    suitesDir: join(base, 'database/tests/suites'),
  }
  cpSync(schemaSource, options.schemaDir, { recursive: true })
  mkdirSync(options.suitesDir, { recursive: true })
  mkdirSync(join(options.root, page), { recursive: true })
  writeFileSync(join(options.root, 'features/user/user.module.ts'), '')
  writeFileSync(join(options.root, page, 'profile.container.tsx'), '')
  writeFileSync(
    join(options.root, page, 'profile.shape.surql'),
    '-- @params $identity: record<identity>\nSELECT id, name FROM profile WHERE identity = $identity LIMIT 1;\n',
  )
  writeFileSync(
    join(options.root, page, 'profile.commands.surql'),
    '-- @command updateName($id: record<profile>, $name: string)\n-- @allow record\nUPDATE $id SET name = $name;\n',
  )
})

describe('runModel', () => {
  it('writes the generated files, after which --check is clean', async () => {
    const written = await runModel({ ...options, check: false })

    expect(written.problems).toEqual([])
    expect(existsSync(join(options.root, page, 'profile.model.gen.ts'))).toBe(true)
    expect(existsSync(join(options.root, page, 'profile.shape.surql.d.ts'))).toBe(true)
    expect(existsSync(join(options.root, 'pages.model.json'))).toBe(true)
    expect(existsSync(join(base, 'database/src/replica.schema.gen.ts'))).toBe(true)
    expect(existsSync(join(options.root, 'replica.schema.gen.ts'))).toBe(false)
    expect(readFileSync(join(options.suitesDir, 'generated-user.toml'), 'utf8')).toContain(
      'user.profile',
    )
    expect((await runModel({ ...options, check: true })).problems).toEqual([])
  })

  it('fails --check after a .surql file changes, and removes stale output', async () => {
    expect((await runModel({ ...options, check: false })).problems).toEqual([])

    writeFileSync(
      join(options.root, page, 'profile.shape.surql'),
      '-- @params $identity: record<identity>\nSELECT id, name, email FROM profile WHERE identity = $identity LIMIT 1;\n',
    )

    expect((await runModel({ ...options, check: true })).problems).toEqual([
      `out of date: ${page}/profile.model.gen.ts`,
      'out of date: pages.model.json',
      'out of date: generated-user.toml',
    ])

    writeFileSync(join(options.root, page, 'old.model.gen.ts'), '')

    expect((await runModel({ ...options, check: true })).problems).toContain(
      `stale: ${page}/old.model.gen.ts`,
    )
    expect((await runModel({ ...options, check: false })).problems).toEqual([])
    expect(existsSync(join(options.root, page, 'old.model.gen.ts'))).toBe(false)
  })

  it('removes a replica schema left in the app sources, now that it lives in the database workspace', async () => {
    writeFileSync(join(options.root, 'replica.schema.gen.ts'), '')

    expect((await runModel({ ...options, check: true })).problems).toContain(
      'stale: replica.schema.gen.ts',
    )
    expect((await runModel({ ...options, check: false })).problems).toEqual([])
    expect(existsSync(join(options.root, 'replica.schema.gen.ts'))).toBe(false)
  })

  it('reports a .surql file that does not parse, by name, and writes nothing', async () => {
    writeFileSync(
      join(options.root, page, 'profile.shape.surql'),
      '-- @params\nSELECT name FROM profile WHERE;\n',
    )

    const result = await runModel({ ...options, check: false })

    expect(result.problems.some((problem) => problem.includes('profile.shape.surql'))).toBe(true)
    expect(existsSync(join(options.root, page, 'profile.model.gen.ts'))).toBe(false)
  })

  it('reports a schema whose id prefixes disagree with the registry', async () => {
    const identitySchema = join(options.schemaDir, 'directory/identity.surql')

    writeFileSync(
      identitySchema,
      readFileSync(identitySchema, 'utf8').replace('-- @id idn', '-- @id idx'),
    )

    expect((await runModel({ ...options, check: false })).problems).toContain(
      'table identity declares -- @id idx but the id registry gives identity the prefix idn',
    )
  })
})
