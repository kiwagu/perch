import { describe, expect, it } from 'vitest'

import { createTranslator, type Translate } from '@workspace/i18n'

import en from '../../../../platform/i18n/app.en.json'
import es from '../../../../platform/i18n/app.es.json'

import { pageTitle } from './page-title'

const english = createTranslator({ en }, 'en') as Translate
const spanish = createTranslator({ en, es }, 'es') as Translate

describe('pageTitle', () => {
  it("names the open screen, then the app, in the user's language", () => {
    expect(pageTitle('/me', english)).toBe('Profile · Perch')
    expect(pageTitle('/devices', spanish)).toBe('Mis dispositivos · Perch')
    expect(pageTitle('/$', english)).toBe('Page not found · Perch')
  })

  it("names the operator's page of the platform's accounts", () => {
    expect(pageTitle('/console/users', english)).toBe('Accounts · Perch')
    expect(pageTitle('/console/users', spanish)).toBe('Cuentas · Perch')
  })

  it('names only the app where no screen is open', () => {
    expect(pageTitle(undefined, english)).toBe('Perch')
    expect(pageTitle('/', english)).toBe('Perch')
  })
})
