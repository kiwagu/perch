import { describe, expect, it } from 'bun:test'

import { languageOf } from './mail-language'

const ACCOUNT = { email: 'ann@example.test', language: 'en' }

describe('languageOf', () => {
  it('reads a source written alone: a parameter, the account', () => {
    expect(languageOf('locale', { params: { locale: 'es' } })).toBe('es')
    expect(languageOf('account', { params: {}, account: ACCOUNT })).toBe('en')
  })
  it('never falls back on the account from a recipient written alone', () => {
    expect(
      languageOf('recipient', { params: {}, account: ACCOUNT, recipient: { language: 'es' } }),
    ).toBe('es')
    expect(() => languageOf('recipient', { params: {}, account: ACCOUNT })).toThrow(
      'the test gave no value for "recipient"',
    )
  })
  it('takes the first source of a list the test gave a language for', () => {
    const values = { params: {}, account: ACCOUNT, organisation: { language: 'es' } }

    expect(
      languageOf(['recipient', 'organisation'], { ...values, recipient: { language: 'en' } }),
    ).toBe('en')
    expect(languageOf(['recipient', 'organisation'], values)).toBe('es')
    expect(languageOf(['recipient', 'locale'], { params: { locale: 'es' } })).toBe('es')
  })
  it('never falls back on the account from a recipient in a list', () => {
    expect(() =>
      languageOf(['recipient', 'organisation'], { params: {}, account: ACCOUNT }),
    ).toThrow('the test gave no value for "organisation"')
  })
  it('moves past a parameter it gave no value for, as one left out, but fails at the last source', () => {
    expect(
      languageOf(['locale', 'organisation'], { params: {}, organisation: { language: 'es' } }),
    ).toBe('es')
    expect(() => languageOf(['recipient', 'locale'], { params: {} })).toThrow(
      'the test gave no value for "locale"',
    )
  })
  it('reads a parameter of the test, never a property every object has', () => {
    expect(() => languageOf(['constructor', 'locale'], { params: {} })).toThrow(
      'the test gave no value for "locale"',
    )
  })
  it('fails for a source written alone the test gave no value for', () => {
    expect(() => languageOf('organisation', { params: {} })).toThrow(
      'the test gave no value for "organisation"',
    )
  })
})
