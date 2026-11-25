import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { termsModuleOf } from '@workspace/ui-contract'
import { heldModule } from '@workspace/ui-contract/testing'

import * as generated from './contract-terms.gen'
import * as kernel from './index'

/**
 * `contract-terms.gen.ts` is what `ui-contract emit terms` writes (`bun run emit`): the roles and
 * the routes of the contract of the working tree, which code and tests name through it. Held as
 * `contract-values.gen.ts` is: on a branch the module may still be what the engine emitted at the
 * branch's merge base with `main` or at its head (`heldModule`).
 */

const ROOT = join(import.meta.dirname, '../../..')

describe('the generated contract terms', () => {
  it('are what the contract says now, or in the ahead mode what it said at the base or the head', () => {
    const committed = readFileSync(join(import.meta.dirname, 'contract-terms.gen.ts'), 'utf8')

    expect(committed).toBe(
      heldModule({ committed, emit: termsModuleOf, root: ROOT, env: process.env }),
    )
  })
  it('are each exported from the package, so code imports them from @workspace/kernel', () => {
    expect(Object.keys(generated).sort()).toEqual([
      'CONTRACT_INVARIANTS',
      'CONTRACT_ROLES',
      'CONTRACT_ROUTES',
    ])
    for (const [name, value] of Object.entries(generated)) {
      expect(kernel[name as keyof typeof kernel], name).toBe(value)
    }
  })
})
