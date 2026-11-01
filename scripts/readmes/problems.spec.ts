import { afterEach, describe, expect, it } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { readmeProblems } from './index.ts'

/** The repositories the tests made, removed after each test. */
const made: string[] = []

const MODULE_BODY = '## Role in the architecture\n\n## Surface\n\n## Commands\n'

/** A repository whose files are given by path; the gateway is its one workspace. */
function repository(files: Readonly<Record<string, string>>): string {
  const root = mkdtempSync(join(tmpdir(), 'readmes-'))
  const all: Record<string, string> = {
    'package.json': JSON.stringify({ workspaces: { packages: ['apps/*'] } }),
    'apps/gateway/package.json': JSON.stringify({ name: '@workspace/gateway' }),
    'apps/gateway/README.md':
      '# Gateway (`@workspace/gateway`)\n\n## Role in the architecture\n\n## Key exports\n\n## Commands\n',
    ...files,
  }

  made.push(root)

  for (const [path, text] of Object.entries(all)) {
    mkdirSync(dirname(join(root, path)), { recursive: true })
    writeFileSync(join(root, path), text)
  }

  return root
}

afterEach(() => {
  for (const root of made.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})

describe('readme problems of gateway modules', () => {
  it('accepts a module whose README names it and has every section', () => {
    const root = repository({
      'apps/gateway/src/limits/README.md': `# Limits (module \`limits\`)\n\n${MODULE_BODY}`,
      'apps/gateway/src/limits/window.ts': '',
    })

    expect(readmeProblems(root)).toEqual([])
  })

  it('asks every folder under the gateway source for a README, the composition root aside', () => {
    const root = repository({
      'apps/gateway/src/limits/window.ts': '',
      'apps/gateway/src/composition/root.ts': '',
      'apps/gateway/src/__fixtures__/rows.ts': '',
      'apps/gateway/src/main.ts': '',
    })

    expect(readmeProblems(root)).toEqual([
      `${join(root, 'apps/gateway/src/limits')}: README.md is missing (module \`limits\`)`,
    ])
  })

  it('reports a title that does not name the module and a missing section', () => {
    const root = repository({
      'apps/gateway/src/auth/README.md':
        '# Auth (module `sign-in`)\n\n## Role in the architecture\n',
    })
    const readme = join(root, 'apps/gateway/src/auth/README.md')

    expect(readmeProblems(root)).toEqual([
      `${readme}: the first line must be "# <Title> (module \`auth\`)"`,
      `${readme}: section "## Surface" is missing`,
      `${readme}: section "## Commands" is missing`,
    ])
  })
})
