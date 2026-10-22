import { ESLint } from 'eslint'
import { describe, expect, it } from 'vitest'

import { base, ignores, importBoundaries } from '../index.js'

const cwd = new URL('../__fixtures__/project/', import.meta.url).pathname
const units = (path) => new URL(`../__fixtures__/project/units/${path}`, import.meta.url).pathname
const server = units('server')

function linter(options) {
  return new ESLint({
    cwd,
    overrideConfigFile: true,
    overrideConfig: [...base.filter((entry) => entry !== ignores), importBoundaries(options)],
  })
}

const eslint = linter({
  modules: [{ root: server, flat: ['legacy'], outside: ['wiring'] }],
  reachIn: [{ folder: units('region'), from: units('older') }],
})

async function messagesIn(file, using = eslint) {
  const [result] = await using.lintFiles([file])

  return result.messages.map((message) => ({ rule: message.ruleId, text: message.message }))
}

describe('workspace/import-through-index', () => {
  it('lets a folder with an index.ts be imported through the index', async () => {
    expect(await messagesIn('units/through-index.ts')).toEqual([])
  })

  it('lets the files of a folder import each other, at any depth', async () => {
    expect(await messagesIn('units/region/pull.ts')).toEqual([])
    expect(await messagesIn('units/region/parts/deep.ts')).toEqual([])
  })

  it('refuses an import of a file inside a folder with an index.ts from outside it', async () => {
    expect(await messagesIn('units/reach-inside.ts')).toEqual([
      {
        rule: 'workspace/import-through-index',
        text: '`./region/push` reaches inside `./region`, a folder entered through its index.ts: import `./region` instead.',
      },
    ])
  })

  it('counts a re-export, a type-only one included, as an import', async () => {
    expect((await messagesIn('units/reexport-inside.ts')).map((message) => message.rule)).toEqual([
      'workspace/import-through-index',
    ])
  })

  it('lets anyone import the fixtures inside a folder: test data, not its internals', async () => {
    expect(await messagesIn('units/fixtures.ts')).toEqual([])
  })

  it("leaves a workspace's own src folder to the package's exports", async () => {
    expect(await messagesIn('units/package/scripts/run.ts')).toEqual([])
  })

  it('enters a module root through its modules, the flat and outside folders file by file', async () => {
    expect(await messagesIn('units/server/main.ts')).toEqual([])
  })

  it('refuses a file of a module that has no index.ts yet', async () => {
    expect(await messagesIn('units/server/reach-module.ts')).toEqual([
      {
        rule: 'workspace/import-through-index',
        text: '`./beta/beta` reaches inside the module `./beta`, which has no index.ts: give it one that re-exports what the rest needs, and import `./beta`.',
      },
    ])
  })

  it('refuses a file of another module from inside a flat one', async () => {
    expect((await messagesIn('units/server/legacy/across.ts')).map((m) => m.rule)).toEqual([
      'workspace/import-through-index',
    ])
  })

  it('refuses a flat entry that has an index.ts or no folder, so the list only shrinks', async () => {
    await expect(
      messagesIn(
        'units/server/main.ts',
        linter({ modules: [{ root: server, flat: ['indexed'] }] }),
      ),
    ).rejects.toThrow('`indexed` has an index.ts now: take it off the flat list')
    await expect(
      messagesIn('units/server/main.ts', linter({ modules: [{ root: server, flat: ['gone'] }] })),
    ).rejects.toThrow('`gone` is not a folder of')
  })

  it('lets a listed folder still reach inside another one, and nobody else', async () => {
    expect(await messagesIn('units/older/read.ts')).toEqual([])
    expect((await messagesIn('units/reach-inside.ts')).map((message) => message.rule)).toEqual([
      'workspace/import-through-index',
    ])
  })

  it('refuses a reach-in into a folder without an index or from a folder that is gone', async () => {
    await expect(
      messagesIn(
        'units/older/read.ts',
        linter({ reachIn: [{ folder: server, from: units('older') }] }),
      ),
    ).rejects.toThrow('has no index.ts: take its reach-in off the list')
    await expect(
      messagesIn(
        'units/older/read.ts',
        linter({ reachIn: [{ folder: units('region'), from: units('gone') }] }),
      ),
    ).rejects.toThrow('is gone: take its reach-in into')
  })
})
