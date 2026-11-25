#!/usr/bin/env bun
/**
 * Fails when TypeScript under the given folders (default: the current one) holds
 * a SurrealQL statement in a literal, or when a `.surql` file there writes a role
 * the contract does not name (`CONTRACT_ROLES`, `findSurqlRoles`). Generated
 * modules and declarations are skipped, and so is the modeling package, whose
 * tests feed SurrealQL text to the parsers they test. `--allow-role
 * <table>.role=<value>` lets that field of that table hold a value that is no
 * role (the auth library's `user` on `identity.role`), there alone.
 *
 * Usage: lint-surql [--allow-role <table>.role=<value> ...] [dir ...]
 */

import { readdirSync, readFileSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

import { CONTRACT_ROLES } from '@workspace/kernel'

import { findSurqlLiterals } from './lint-literals'
import { findSurqlRoles } from './surql-roles'

const SKIP_DIRS = new Set([
  'node_modules',
  'dist',
  'coverage',
  'refs',
  'playwright-report',
  'test-results',
])

const MODELING_SOURCES = ['packages', 'modeling', 'src'].join(sep)

/** The files under `dir` whose name `keep` takes, skipped folders aside. */
function filesUnder(dir: string, keep: (name: string) => boolean): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)

    if (entry.isDirectory()) {
      return SKIP_DIRS.has(entry.name) || entry.name.startsWith('.') ? [] : filesUnder(path, keep)
    }

    return keep(entry.name) ? [path] : []
  })
}

const args = process.argv.slice(2)
const allowed = new Map<string, Set<string>>()
const roots: string[] = []

for (let index = 0; index < args.length; index++) {
  const arg = args[index] ?? ''

  if (arg === '--allow-role') {
    const [field = '', value = ''] = (args[++index] ?? '').split('=')

    allowed.set(field, new Set([...(allowed.get(field) ?? []), value]))
  } else {
    roots.push(arg)
  }
}

const sources = (keep: (name: string) => boolean): string[] =>
  (roots.length > 0 ? roots : ['.'])
    .flatMap((root) => filesUnder(root, keep))
    .filter((path) => !relative('.', path).startsWith(MODELING_SOURCES))
const roles = new Set<string>(Object.values(CONTRACT_ROLES))
const literals = sources((name) => /\.tsx?$/.test(name) && !/\.(gen|d)\.ts$/.test(name)).flatMap(
  (path) => findSurqlLiterals(relative('.', path), readFileSync(path, 'utf8')),
)
const strayRoles = sources((name) => name.endsWith('.surql')).flatMap((path) =>
  findSurqlRoles(relative('.', path), readFileSync(path, 'utf8'), roles, allowed),
)

for (const violation of literals) {
  console.error(
    `${violation.path}:${violation.line} ${violation.rule}: SurrealQL belongs in a .surql file: ${violation.text}`,
  )
}

for (const violation of strayRoles) {
  console.error(
    `${violation.path}:${violation.line} ${violation.rule}: '${violation.text}' is no role of the contract: write a role contract/domain/terms.yaml names (CONTRACT_ROLES)`,
  )
}

const violations = [...literals, ...strayRoles]

if (violations.length > 0) {
  process.exit(1)
}
