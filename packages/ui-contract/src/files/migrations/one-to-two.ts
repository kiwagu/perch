/**
 * Version 1 to 2: the version is said once, in `platform.yaml`. A vocabulary at version 1 repeats
 * it in its `Contract version: 1` line; the step removes that line and the blank line after it.
 * `migrate` sets the platform's `version`, so nothing is left by hand.
 */

import { VERSION_LINE } from '../vocabulary'

import type { Migration } from './migration'

/** `text` without its contract version line and the one blank line after it, if any. */
function withoutVersionLine(text: string): string {
  const found = VERSION_LINE.exec(text)

  if (found === null) {
    return text
  }

  const rest = text.slice(found.index + found[0].length).replace(/^\n\n?/, '')

  return `${text.slice(0, found.index)}${rest}`
}

export const oneToTwo: Migration = {
  from: 1,
  note: 'the version is said once, in platform.yaml: the vocabulary drops its "Contract version" line',
  run: (files) => {
    files.vocabulary = withoutVersionLine(files.vocabulary)

    return []
  },
}
