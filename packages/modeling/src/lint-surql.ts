#!/usr/bin/env bun
/**
 * Fails when TypeScript under the given folders (default: the current one) holds
 * a SurrealQL statement in a literal. Generated modules and declarations are
 * skipped, and so is the modeling package, whose tests feed SurrealQL text to the
 * parsers they test.
 *
 * Usage: lint-surql [dir ...]
 */

import { readdirSync, readFileSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

import { findSurqlLiterals } from './lint-literals'

const SKIP_DIRS = new Set([
  'node_modules',
  'dist',
  'coverage',
  'refs',
  'playwright-report',
  'test-results',
])

const MODELING_SOURCES = ['packages', 'modeling', 'src'].join(sep)

function typescriptFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)

    if (entry.isDirectory()) {
      return SKIP_DIRS.has(entry.name) || entry.name.startsWith('.') ? [] : typescriptFiles(path)
    }

    return /\.tsx?$/.test(entry.name) && !/\.(gen|d)\.ts$/.test(entry.name) ? [path] : []
  })
}

const roots = process.argv.slice(2)
const violations = (roots.length > 0 ? roots : ['.'])
  .flatMap((root) => typescriptFiles(root))
  .filter((path) => !relative('.', path).startsWith(MODELING_SOURCES))
  .flatMap((path) => findSurqlLiterals(relative('.', path), readFileSync(path, 'utf8')))

for (const violation of violations) {
  console.error(
    `${violation.path}:${violation.line} ${violation.rule}: SurrealQL belongs in a .surql file: ${violation.text}`,
  )
}

if (violations.length > 0) {
  process.exit(1)
}
