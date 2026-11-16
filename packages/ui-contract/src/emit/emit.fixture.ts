/**
 * A repository for the specs of the emitted modules: the default-length repository at a version
 * (`writeDefaultsRepository`: the value `name` and the model's `thing.title` name no limit, the
 * value `email` takes 254 characters, `password` writes `maxLength: null` where a default is
 * given), with on the sample screen one field of each kind of fact:
 *
 * - `sample.reason-input`, which the sign-out button passes as the `email` value and which writes
 *   `marksState: false`;
 * - `sample.code-input`, a secret input the button passes as the `email` value too;
 * - `sample.email-input`, bound to the model's `thing.email`, a read-only email;
 * - `sample.forget-checkbox`, which runs the sign-out with itself alone, so it holds no input;
 * - `sample.title-input`, bound to `thing.title`, which holds input and writes nothing.
 *
 * The vocabulary gains the kind `checkbox` and the suffix `visibility-button` they need, so the
 * repository passes the contract check at version 5 and at version 6.
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { MODEL_FILE, PLATFORM_FILE, VOCABULARY_FILE } from '../files'
import { writeDefaultsRepository } from '../files/values/defaults.fixture'

export interface EmitRepository {
  readonly version: number
  /** The default length the platform writes; none where it is undefined. */
  readonly defaults?: number
}

const SCREEN_FILE = 'contract/domain/screens/sample/$key.yaml'

const REASON = '{ value: email, optional: true, description: Why. }'

/** The sign-out button's last parameter, after which the fields are written. */
const FORGET_UNSENT = '        forgetUnsent:\n          value: true\n'

const FIELDS = `        reason: sample.reason-input
        code: sample.code-input
  sample.reason-input:
    kind: input
    marksState: false
  sample.code-input:
    kind: input
    secret: true
  sample.email-input:
    kind: input
    binding: { model: thing.email }
  sample.forget-checkbox:
    kind: checkbox
    binding: { action: platform.sign-out, params: { forgetUnsent: sample.forget-checkbox } }
`

const BUTTON_KIND = "| `button` | a control that performs an action | `getByRole('button')` |\n"
const CHECKBOX_KIND = "| `checkbox` | a field ticked or not | `getByRole('checkbox')` |\n"
const OPTION_SUFFIX = '| `option` | one entry of a select |\n'
const VISIBILITY_SUFFIX = '| `visibility-button` | the eye of a password input |\n'

const EMAIL_FIELD =
  '"email": { "type": "string", "format": "email", "maxLength": 254, "x-perch": { "readonly": true } },'

/**
 * The data an emitted module holds: the object after `export const <NAME> = `, up to ` as const`,
 * which the engine writes as JSON.
 */
export function moduleData(text: string): unknown {
  const start = /^export const [A-Z_]+ = /m.exec(text)
  const end = text.lastIndexOf(' as const')

  if (start === null || end === -1) {
    throw new Error(`no exported constant in:\n${text}`)
  }

  return JSON.parse(text.slice(start.index + start[0].length, end))
}

/** Replaces `from` in the file once, failing when the file does not hold it. */
function edit(root: string, file: string, from: string, to: string): void {
  const text = readFileSync(join(root, file), 'utf8')

  if (!text.includes(from)) {
    throw new Error(`${file} does not hold ${JSON.stringify(from)}`)
  }

  writeFileSync(join(root, file), text.replace(from, to))
}

/** Writes the sample at `options.version` into the empty folder `root`. */
export function writeEmitRepository(root: string, { version, defaults }: EmitRepository): void {
  writeDefaultsRepository(root, {
    version,
    ...(defaults === undefined ? {} : { defaults, withNull: true }),
    title: undefined,
    reason: REASON,
  })
  edit(
    root,
    PLATFORM_FILE,
    `      reason: ${REASON}\n`,
    `      reason: ${REASON}\n      code: { value: email, optional: true, description: A code. }\n`,
  )
  edit(root, MODEL_FILE, '"created_at": {', `${EMAIL_FIELD}\n        "created_at": {`)
  edit(root, SCREEN_FILE, FORGET_UNSENT, `${FORGET_UNSENT}${FIELDS}`)
  edit(root, VOCABULARY_FILE, BUTTON_KIND, `${BUTTON_KIND}${CHECKBOX_KIND}`)
  edit(root, VOCABULARY_FILE, OPTION_SUFFIX, `${OPTION_SUFFIX}${VISIBILITY_SUFFIX}`)
}
