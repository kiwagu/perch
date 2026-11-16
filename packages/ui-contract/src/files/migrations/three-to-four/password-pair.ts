/**
 * The password pair of a screen file, written as the loader derives it: a screen whose flow
 * declares guards the pair derives (`passwordBreaksRules`, `passwordsDiffer`,
 * `confirmationStrays`, `confirmationFollows`) and holds exactly one secret input with a
 * composite and exactly one secret input with no binding, a second one, gets `confirms: <the
 * input with the composite>` on that one and loses the guards. A screen that writes `confirms`
 * already only loses them. Any other shape is left as it is and named: the confirmation is not
 * the migration's to guess. So is a guard of those names that is not a sentence, which the
 * derived guard would replace by another meaning.
 */

import { recordOf } from '../../../records'
import { PAIR_GUARDS } from '../../derive'

import { anchorsOf, fileOf, plainOf, type ScreenDocuments } from './screens'

const GUARDS = Object.keys(PAIR_GUARDS)

const UNDECIDED =
  'and the screen has no one confirmation to tell: it needs exactly one secret input with a composite and exactly one other secret input with no binding'
const NOT_SENTENCES = 'but one of them is not a sentence'

/** The one anchor of `found`, when it holds one alone. */
const onlyOf = (found: ReadonlyArray<readonly [string, unknown]>): string | undefined =>
  found.length === 1 ? found[0]?.[0] : undefined

/** The lines left to do by hand after the password pairs of every screen are written as derived. */
export function writePasswordPairs(screens: ScreenDocuments): string[] {
  const manual: string[] = []

  for (const [path, document] of screens) {
    const screen = plainOf(document)
    const meta = recordOf(recordOf(screen['flow'])['meta'])
    const guards = recordOf(meta['guards'])
    const named = GUARDS.filter((name) => Object.hasOwn(guards, name))

    if (named.length === 0) {
      continue
    }

    const anchors = anchorsOf(screen)
    const secrets = anchors.filter(([, def]) => def['kind'] === 'input' && def['secret'] === true)
    const writes = onlyOf(anchors.filter(([, def]) => def['confirms'] !== undefined))
    const composite = onlyOf(secrets.filter(([, def]) => def['composite'] !== undefined))
    const confirmation = onlyOf(secrets.filter(([, def]) => def['binding'] === undefined))
    const pair =
      writes === undefined &&
      composite !== undefined &&
      confirmation !== undefined &&
      composite !== confirmation
        ? { composite, confirmation }
        : undefined
    const decided = writes !== undefined || pair !== undefined
    const sentences = named.every((name) => typeof guards[name] === 'string')

    if (!decided || !sentences) {
      manual.push(
        `${fileOf(path)}: ${named.join(', ')} name a password pair, ${decided ? NOT_SENTENCES : UNDECIDED}: write \`confirms: <the input with the composite>\` on the confirmation and drop the guards by hand`,
      )

      continue
    }

    if (pair !== undefined) {
      document.setIn(['anchors', pair.confirmation, 'confirms'], pair.composite)
    }

    const kept = Object.keys(guards).filter((name) => !named.includes(name))

    if (kept.length > 0) {
      for (const name of named) {
        document.deleteIn(['flow', 'meta', 'guards', name])
      }
    } else if (Object.keys(meta).length > 1) {
      document.deleteIn(['flow', 'meta', 'guards'])
    } else {
      document.deleteIn(['flow', 'meta'])
    }
  }

  return manual
}
