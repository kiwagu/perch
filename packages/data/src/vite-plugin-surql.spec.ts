import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { surqlPlugin } from './vite-plugin-surql'

describe('surqlPlugin', () => {
  const dir = mkdtempSync(join(tmpdir(), 'surql-plugin-'))
  const file = join(dir, 'upsert.surql')

  writeFileSync(file, 'RETURN 1;\n')

  it('loads a plain .surql file as its text', () => {
    const plugin = surqlPlugin()
    const load = plugin.load as (id: string) => string | undefined

    expect(load(file)).toBe(`export default ${JSON.stringify('RETURN 1;\n')}`)
  })

  it('turns a shape or commands file into the object the modeling stage generated', () => {
    const load = surqlPlugin().load as (id: string) => string | undefined

    expect(load('/app/features/user/pages/profile/profile.shape.surql')).toBe(
      "export { profileShape as default } from './profile.model.gen'",
    )
    expect(load('/app/features/user/pages/sign-in/sign-in.commands.surql?import')).toBe(
      "export { signInCommands as default } from './sign-in.model.gen'",
    )
  })

  it('leaves other modules alone', () => {
    const load = surqlPlugin().load as (id: string) => string | undefined

    expect(load(join(dir, 'index.ts'))).toBeUndefined()
  })
})
