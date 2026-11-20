/**
 * The links of the guides into the reference: a guide that points at a facet's rule links to
 * `contract/REFERENCE.md#<slug>` instead of restating it, and each such link must name an anchor
 * the reference has, so a renamed key or rule leaves no dead pointer behind.
 */

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { GUIDE_FILES, type Problem, REFERENCE_FILE } from '../files'

const ANCHOR = /<a id="([^"]+)"><\/a>/g
/**
 * A link's whole fragment: everything after `#` up to the delimiter that closes it, a space, a
 * parenthesis, a bracket, a backtick, a quote or `>`, so `#<slug>`, the placeholder, is no link and
 * `#screen-anchors-name-secret.typo` is compared whole, never by a prefix that happens to exist.
 */
const LINK = /REFERENCE\.md#(?!<)([^\s)\]>`"']+)/g

const anchorsOf = (root: string): ReadonlySet<string> => {
  const path = join(root, REFERENCE_FILE)

  return existsSync(path)
    ? new Set(Array.from(readFileSync(path, 'utf8').matchAll(ANCHOR), (match) => match[1] ?? ''))
    : new Set()
}

function problemsOf(file: string, text: string, anchors: ReadonlySet<string>): Problem[] {
  return text.split('\n').flatMap((line, index) =>
    Array.from(line.matchAll(LINK), (match) => match[1] ?? '')
      .filter((slug) => !anchors.has(slug))
      .map((slug) => ({
        file,
        line: index + 1,
        message: `links to ${REFERENCE_FILE}#${slug}, which is no anchor of the reference`,
      })),
  )
}

/**
 * One problem for each `REFERENCE.md#<slug>` in a guide (`GUIDE_FILES`, those that exist) whose
 * slug is no anchor of `contract/REFERENCE.md`; a guide without a link has none.
 */
export function referenceLinkProblems(root: string): Problem[] {
  const anchors = anchorsOf(root)

  return GUIDE_FILES.filter((file) => existsSync(join(root, file))).flatMap((file) =>
    problemsOf(file, readFileSync(join(root, file), 'utf8'), anchors),
  )
}
