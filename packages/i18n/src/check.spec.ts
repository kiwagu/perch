import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { checkI18n } from './check'

function project(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'i18n-'))

  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true })
    writeFileSync(join(root, path), text)
  }

  return root
}

const catalogs = {
  'i18n/app.en.json': JSON.stringify({
    'x.y': 'Y',
    'x.count.one': 'one',
    'x.count.other': 'many',
    'x.cond.a': 'A',
    'x.cond.b': 'B',
  }),
  'i18n/app.es.json': JSON.stringify({ 'x.y': 'Y' }),
}

describe('checkI18n', () => {
  it('passes when every used key exists and every key is used, listing the Spanish gap', () => {
    const root = project({
      ...catalogs,
      'view.tsx': "t('x.y'); t('x.count', { count }); t(ok ? 'x.cond.a' : 'x.cond.b')",
    })

    expect(checkI18n(root)).toEqual({
      errors: [],
      missingInEs: ['x.cond.a', 'x.cond.b', 'x.count.one', 'x.count.other'],
    })
  })

  it('reports a key missing from en, a dead key and a non-static key', () => {
    const root = project({
      ...catalogs,
      'view.tsx':
        // biome-ignore lint/suspicious/noTemplateCurlyInString: the source under test contains a template literal
        "t('x.y'); t('x.nope'); t(`x.${part}`); t('x.count', { count }); t(ok ? 'x.cond.a' : 'x.cond.b')",
      'other.ts': 't(name)',
    })

    expect(checkI18n(root).errors).toEqual([
      'other.ts:1 the argument of t() must be a literal key',
      'view.tsx:1 key x.nope is not in the en catalog',
      'view.tsx:1 the argument of t() must be a literal key',
    ])
  })

  it('reports an en key that nothing uses', () => {
    const root = project({ ...catalogs, 'view.tsx': "t('x.y'); t('x.count', { count })" })

    expect(checkI18n(root).errors).toEqual([
      'i18n/app.en.json: key x.cond.a is not used',
      'i18n/app.en.json: key x.cond.b is not used',
    ])
  })
})
