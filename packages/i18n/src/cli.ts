#!/usr/bin/env bun
/**
 * `i18n-check [--root <dir>]`: checks the translation keys under a source root.
 * Exit code 1 on an error; keys missing only in Spanish are reported and pass.
 */

import { resolve } from 'node:path'

import { checkI18n } from './check'

const index = process.argv.indexOf('--root')
const root = resolve(index >= 0 ? (process.argv[index + 1] ?? 'src') : 'src')
const report = checkI18n(root)

for (const error of report.errors) {
  console.error(`i18n: ${error}`)
}

if (report.missingInEs.length > 0) {
  console.warn(
    `i18n: ${report.missingInEs.length} key(s) not yet in Spanish: ${report.missingInEs.join(', ')}`,
  )
}

if (report.errors.length > 0) {
  process.exit(1)
}

console.log('i18n: every key is defined and used')
