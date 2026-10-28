/**
 * Which files the size tiers measure and how their lines are counted, the same for a file on
 * disk and for a file as committed. Declaration files, generated modules, fixtures, vendored
 * skills and (unless asked for) tests are not measured, and neither are symlinks: git stores a
 * symlink as its target path while the disk reads through it, so the target is measured at its
 * own path only.
 */

import { extname } from 'node:path'

const EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'])

const SKIPPED = [
  /^\.agents\//,
  /\.d\.ts$/,
  /\.gen\.ts$/,
  /(^|\/)dist\//,
  /(^|\/)coverage\//,
  /(^|\/)__fixtures__\//,
]

const TEST_FILE = /\.(spec|test)\.[cm]?[jt]sx?$|(^|\/)tests\/e2e\//

export function isMeasured(path: string, includeTests: boolean): boolean {
  return (
    EXTENSIONS.has(extname(path)) &&
    !SKIPPED.some((pattern) => pattern.test(path)) &&
    (includeTests || !TEST_FILE.test(path))
  )
}

export function countLines(text: string): number {
  if (text === '') {
    return 0
  }

  return text.endsWith('\n') ? text.split('\n').length - 1 : text.split('\n').length
}
