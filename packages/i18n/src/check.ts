/**
 * Checks translation keys against the code: every `t('<key>')` must name a key
 * of the English catalog, every English key must be used, and the argument of
 * `t` must be a literal (or a template without expressions, or a choice between
 * two literals) so the key stays greppable and checkable. Keys missing only in
 * the Spanish catalog are listed but are not an error.
 */

import { readdirSync, readFileSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

import { type Expression, parseSync, Visitor } from 'oxc-parser'

export interface I18nReport {
  readonly errors: readonly string[]
  readonly missingInEs: readonly string[]
}

const SKIP = new Set(['node_modules', 'dist', 'coverage'])

const PLURAL_FORMS = ['zero', 'one', 'two', 'few', 'many', 'other']

function files(root: string, dir = root): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)

    if (entry.isDirectory()) {
      return SKIP.has(entry.name) || entry.name.startsWith('.') ? [] : files(root, path)
    }

    return [path]
  })
}

const posix = (path: string): string => path.split(sep).join('/')

/** The keys a `t()` argument names, or undefined when it is not static. */
function keysOf(argument: Expression | undefined): string[] | undefined {
  if (argument?.type === 'Literal' && typeof argument.value === 'string') {
    return [argument.value]
  }

  if (argument?.type === 'TemplateLiteral' && argument.expressions.length === 0) {
    return [argument.quasis[0]?.value.cooked ?? '']
  }

  if (argument?.type === 'ConditionalExpression') {
    const branches = [keysOf(argument.consequent), keysOf(argument.alternate)]

    return branches.every((branch) => branch?.length === 1)
      ? (branches.flat() as string[])
      : undefined
  }

  return undefined
}

export function checkI18n(root: string): I18nReport {
  const all = files(root)
  const en = new Map<string, string>()
  const es = new Set<string>()
  const errors: string[] = []
  const used = new Set<string>()

  for (const path of all.filter((file) => file.endsWith('.en.json') || file.endsWith('.es.json'))) {
    const catalog = JSON.parse(readFileSync(path, 'utf8')) as Record<string, string>

    for (const key of Object.keys(catalog)) {
      if (path.endsWith('.es.json')) {
        es.add(key)
      } else {
        en.set(key, posix(relative(root, path)))
      }
    }
  }

  const sources = all.filter(
    (path) => /\.tsx?$/.test(path) && !/\.(spec|test)\.tsx?$|\.d\.ts$|\.gen\.ts$/.test(path),
  )

  for (const path of sources) {
    const text = readFileSync(path, 'utf8')
    const name = posix(relative(root, path))
    const line = (offset: number): number => text.slice(0, offset).split('\n').length
    const { program } = parseSync(path, text, {
      lang: path.endsWith('x') ? 'tsx' : 'ts',
      sourceType: 'module',
    })

    new Visitor({
      CallExpression(node) {
        if (node.callee.type !== 'Identifier' || node.callee.name !== 't') {
          return
        }

        const keys = keysOf(node.arguments[0] as Expression | undefined)

        if (!keys) {
          errors.push(`${name}:${line(node.start)} the argument of t() must be a literal key`)

          return
        }

        for (const key of keys) {
          const forms = PLURAL_FORMS.map((form) => `${key}.${form}`).filter((form) => en.has(form))

          if (!en.has(key) && forms.length === 0) {
            errors.push(`${name}:${line(node.start)} key ${key} is not in the en catalog`)
          }

          for (const found of [key, ...forms]) {
            used.add(found)
          }
        }
      },
    }).visit(program)
  }

  for (const [key, file] of en) {
    if (!used.has(key)) {
      errors.push(`${file}: key ${key} is not used`)
    }
  }

  return {
    errors: errors.sort(),
    missingInEs: [...en.keys()].filter((key) => !es.has(key)).sort(),
  }
}
