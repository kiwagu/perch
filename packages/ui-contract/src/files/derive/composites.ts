/**
 * A composite the platform declares once (`platform.yaml` `composites`), derived into a screen
 * whose secret input opts in with `composite: <name>`: the list `<screen>.<list>` (kind
 * `list`, the composite's description) and, per item, `<screen>.<list>.<item>-item` (kind
 * `item`, the item's description, the composite's item state), inserted after the input, each
 * marked `derivedFrom`. A written anchor with a derived id doubles it and is refused; so is
 * an unknown composite, an opt-in on anything but a secret input, and a second opt-in on the
 * same screen, which would derive the same ids.
 */

import { entriesOf, isRecord } from '../../records'
import type { PlatformComposite } from '../../schemas'
import { jsonPath, type Problem } from '../problems'

/** The anchors a composite derives on `screen`: its list, and its items by name. */
export function compositeAnchorsOf(
  screen: string,
  composite: PlatformComposite,
): { list: string; items: Record<string, string> } {
  const list = `${screen}.${composite.list}`

  return {
    list,
    items: Object.fromEntries(
      Object.keys(composite.items).map((item) => [item, `${list}.${item}-item`]),
    ),
  }
}

const problemAt = (file: string, at: readonly PropertyKey[], message: string): Problem => ({
  file,
  message: `${jsonPath(at)}: ${message}`,
})

/** The anchors a composite derives, as the canonical screen holds them. */
function derivedAnchorsOf(
  name: string,
  composite: PlatformComposite,
  screen: string,
): Array<[string, unknown]> {
  const { list, items } = compositeAnchorsOf(screen, composite)

  return [
    [list, { kind: 'list', description: composite.description, derivedFrom: { composite: name } }],
    ...Object.entries(items).map(([item, anchor]): [string, unknown] => [
      anchor,
      {
        kind: 'item',
        description: composite.items[item],
        states: [composite.itemState],
        derivedFrom: { composite: name, item },
      },
    ]),
  ]
}

/** `screen` as read, the composites its inputs opt into derived, with the problems found. */
export function withDerivedComposites(
  file: string,
  screen: unknown,
  composites: Readonly<Record<string, PlatformComposite>>,
): { value: unknown; problems: Problem[] } {
  const anchors = isRecord(screen) ? screen['anchors'] : undefined
  const id = isRecord(screen) ? screen['id'] : undefined

  if (!isRecord(screen) || !isRecord(anchors) || typeof id !== 'string') {
    return { value: screen, problems: [] }
  }

  const problems: Problem[] = []
  const optedIn = new Map<string, string>()
  const out: Array<[string, unknown]> = []

  for (const [anchor, written] of entriesOf(anchors)) {
    // The loader parses with the canonical schema, so a written `derivedFrom` is refused here, as `asks` is.
    const { derivedFrom, ...def } = isRecord(written) ? written : {}

    if (isRecord(written) && derivedFrom !== undefined) {
      problems.push(
        problemAt(
          file,
          ['anchors', anchor, 'derivedFrom'],
          'derivedFrom is derived from a composite of the platform: a screen file never writes it',
        ),
      )
    }

    out.push([anchor, isRecord(written) ? def : written])

    const name = isRecord(written) ? def['composite'] : undefined

    // Any other `composite` value stays for the canonical schema to refuse.
    if (!isRecord(written) || typeof name !== 'string') {
      continue
    }

    const at = ['anchors', anchor, 'composite']
    const composite = Object.hasOwn(composites, name) ? composites[name] : undefined
    const first = optedIn.get(name)

    if (composite === undefined) {
      problems.push(problemAt(file, at, `"${name}" is not a composite of platform.yaml`))
    } else if (def['kind'] !== 'input' || def['secret'] !== true) {
      problems.push(problemAt(file, at, 'only a secret input opts into a composite'))
    } else if (first !== undefined) {
      problems.push(
        problemAt(
          file,
          at,
          `the composite ${name} is derived once per screen; ${first} opted in already`,
        ),
      )
    } else {
      optedIn.set(name, anchor)

      for (const [derived, value] of derivedAnchorsOf(name, composite, id)) {
        if (Object.hasOwn(anchors, derived)) {
          problems.push(
            problemAt(
              file,
              ['anchors', derived],
              `derived by the composite ${name} of ${anchor}: a written anchor never doubles a derived one`,
            ),
          )
        } else {
          out.push([derived, value])
        }
      }
    }
  }

  return { value: { ...screen, anchors: Object.fromEntries(out) }, problems }
}
