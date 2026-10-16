import { describe, expect, it } from 'vitest'

import { createTranslator, matchLocale } from './translator'

const en = {
  'a.b': 'Save',
  'a.greet': 'Hello, {name}!',
  'a.count.one': '{count} profile',
  'a.count.other': '{count} profiles',
  'a.only-en': 'English only',
} as const

const es = {
  'a.b': 'Guardar',
  'a.count.one': '{count} perfil',
  'a.count.other': '{count} perfiles',
}

describe('createTranslator', () => {
  it('returns the value of a key in the chosen language', () => {
    expect(createTranslator({ en, es }, 'en')('a.b')).toBe('Save')
    expect(createTranslator({ en, es }, 'es')('a.b')).toBe('Guardar')
  })

  it('substitutes parameters', () => {
    expect(createTranslator({ en }, 'en')('a.greet', { name: 'Ann' })).toBe('Hello, Ann!')
  })

  it('chooses the plural form by count', () => {
    const t = createTranslator({ en, es }, 'en')

    expect(t('a.count', { count: 1 })).toBe('1 profile')
    expect(t('a.count', { count: 2 })).toBe('2 profiles')
    expect(createTranslator({ en, es }, 'es')('a.count', { count: 2 })).toBe('2 perfiles')
  })

  it('falls back to English, then to the key itself', () => {
    const t = createTranslator({ en, es }, 'es')

    expect(t('a.only-en')).toBe('English only')
    expect((t as (key: string) => string)('a.unknown')).toBe('a.unknown')
  })
})

describe('matchLocale', () => {
  it('picks a supported language from a browser tag or defaults to English', () => {
    expect(matchLocale('es-AR')).toBe('es')
    expect(matchLocale('en-GB')).toBe('en')
    expect(matchLocale('pl-PL')).toBe('en')
    expect(matchLocale(undefined)).toBe('en')
  })
})
