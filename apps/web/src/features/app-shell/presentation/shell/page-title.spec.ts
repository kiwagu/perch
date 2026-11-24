import { describe, expect, it } from 'vitest'

import { createTranslator, type Translate } from '@workspace/i18n'
import { CONTRACT_ROUTES } from '@workspace/kernel'

import en from '../../../../platform/i18n/app.en.json'
import es from '../../../../platform/i18n/app.es.json'

import { pageTitle } from './page-title'

const english = createTranslator({ en }, 'en') as Translate
const spanish = createTranslator({ en, es }, 'es') as Translate

describe('pageTitle', () => {
  it("names the open screen, then the app, in the user's language", () => {
    expect(pageTitle(CONTRACT_ROUTES['user.profile'], english)).toBe('Profile · Perch')
    expect(pageTitle(CONTRACT_ROUTES.device, spanish)).toBe('Mis dispositivos · Perch')
    expect(pageTitle(CONTRACT_ROUTES['not-found'], english)).toBe('Page not found · Perch')
  })

  it("names the operator's page of the platform's accounts", () => {
    expect(pageTitle(CONTRACT_ROUTES['console.users'], english)).toBe('Accounts · Perch')
    expect(pageTitle(CONTRACT_ROUTES['console.users'], spanish)).toBe('Cuentas · Perch')
  })

  it("names the operator's card of one account", () => {
    expect(pageTitle(CONTRACT_ROUTES['console.account'], english)).toBe('Account · Perch')
    expect(pageTitle(CONTRACT_ROUTES['console.account'], spanish)).toBe('Cuenta · Perch')
  })

  it('names only the app where no screen is open', () => {
    expect(pageTitle(undefined, english)).toBe('Perch')
    expect(pageTitle('/', english)).toBe('Perch')
  })
})
