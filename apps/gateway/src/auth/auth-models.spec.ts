import { describe, expect, it } from 'vitest'

import { AUTH_MODELS, generateAuthId } from './auth-models'

describe('generateAuthId', () => {
  it.each([
    ['user', /^idn_/],
    ['identity', /^idn_/],
    ['session', /^dvs_/],
    ['device_session', /^dvs_/],
    ['account', /^acc_/],
    ['verification', /^vrf_/],
  ])('mints an id of our format for model %s', (model, prefix) => {
    expect(generateAuthId({ model })).toMatch(prefix)
    expect(generateAuthId({ model })).toMatch(/^[a-z]{3}_[0-9a-z]{16}\.[0-9a-z]{10}$/)
  })

  it('refuses a model it does not know', () => {
    expect(() => generateAuthId({ model: 'jwks' })).toThrow(/no id kind for model jwks/)
  })
})

describe('AUTH_MODELS', () => {
  it('names our tables and snake_case columns', () => {
    expect(AUTH_MODELS.user.modelName).toBe('identity')
    expect(AUTH_MODELS.session.modelName).toBe('device_session')
    expect(AUTH_MODELS.session.fields.userId).toBe('identity')
    expect(AUTH_MODELS.account.fields.providerId).toBe('provider_id')
  })
})
