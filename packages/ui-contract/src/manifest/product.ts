/** The product a manifest describes: the root package's version and the commit checked out. */

import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { z } from '@workspace/zod'

import type { Product } from './manifest.types'

const rootPackageSchema = z.looseObject({ version: z.string().min(1) })

const COMMIT = /^[0-9a-f]{40}$/

/** The commit checked out at `root`, or null outside git. */
function commitAt(root: string): string | null {
  const result = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' })
  const commit = result.status === 0 ? result.stdout.trim() : ''

  return COMMIT.test(commit) ? commit : null
}

export function productInfo(root: string): Product {
  const { version } = rootPackageSchema.parse(
    JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')),
  )

  return { name: 'perch', version, commit: commitAt(root) }
}
