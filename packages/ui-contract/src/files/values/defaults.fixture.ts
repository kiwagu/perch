/**
 * A repository for the specs of the default length: the package's fixture repository at a
 * version, its platform declaring the values `VALUES` (a string that names no limit, an email of
 * its own limit, a password that writes `maxLength: null` where `withNull`), the default length
 * `defaults` where one is given, and `sign-out` taking a `reason` of `reason` (the value `name`
 * by default); the model's `thing.title` writes the limit `title`, none where it is undefined.
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { writeContractRepository } from '../../contract-repository.fixture'
import { MODEL_FILE, PLATFORM_FILE, VOCABULARY_FILE } from '../paths'

export interface DefaultsRepository {
  readonly version: number
  readonly defaults?: number
  readonly withNull?: boolean
  /** The limit `values.name` writes; none by default. */
  readonly name?: number
  /** The limit the model's `thing.title` writes; none where it is undefined. */
  readonly title?: number | undefined
  /** What `sign-out`'s `reason` writes, a YAML flow map. */
  readonly reason?: string
  /** The codes `sign-out` declares beyond `failed`, each with a condition of its own. */
  readonly codes?: readonly string[]
}

const valuesOf = ({ withNull = false, name }: DefaultsRepository): string => `values:
  name:
    type: string
    minLength: 1${name === undefined ? '' : `\n    maxLength: ${name}`}
    description: A name.
  email:
    type: string
    format: email
    maxLength: 254
    description: An email address.
  password:
    type: string
    minLength: 1${withNull ? '\n    maxLength: null' : ''}
    description: A password as the account has it now.
`

const read = (root: string, file: string): string => readFileSync(join(root, file), 'utf8')

/** Writes the sample at `options.version` into the empty folder `root`. */
export function writeDefaultsRepository(root: string, options: DefaultsRepository): void {
  const {
    version,
    defaults,
    title,
    reason = '{ value: name, optional: true, description: Why. }',
    codes = [],
  } = options

  writeContractRepository(root)
  writeFileSync(
    join(root, PLATFORM_FILE),
    read(root, PLATFORM_FILE)
      .replace(
        'version: 1\n',
        `version: ${version}\n${defaults === undefined ? '' : `defaults:\n  maxLength: ${defaults}\n`}${valuesOf(options)}`,
      )
      .replace(
        '        description: Drop the unsent changes.\n',
        `        description: Drop the unsent changes.\n      reason: ${reason}\n`,
      )
      // A map, the form every version reads and the one version 6 asks for.
      .replace(
        '    codes:\n      - failed\n',
        `    codes:\n      failed: the device cannot reach the server\n${codes.map((code) => `      ${code}: the request answers ${code}\n`).join('')}`,
      ),
  )
  writeFileSync(
    join(root, MODEL_FILE),
    read(root, MODEL_FILE).replace(
      '"maxLength": 80,',
      title === undefined ? '' : `"maxLength": ${title},`,
    ),
  )
  writeFileSync(
    join(root, VOCABULARY_FILE),
    read(root, VOCABULARY_FILE).replace('Contract version: 1\n\n', ''),
  )
}
