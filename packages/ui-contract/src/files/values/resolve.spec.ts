import { describe, expect, it } from 'vitest'

import { parameterValueOf, resolveValue } from './resolve'
import { EMAIL, MODEL, PLATFORM } from './values.fixture'

describe('resolveValue', () => {
  it('resolves a platform value to its constraints, its description and examples aside', () => {
    expect(resolveValue('email', PLATFORM, MODEL)).toEqual(EMAIL)
  })
  it('resolves a field of the model to the constraints its JSON Schema writes', () => {
    expect(resolveValue('profile.name', PLATFORM, MODEL)).toEqual({
      type: 'string',
      minLength: 1,
      maxLength: 80,
    })
  })
  it('resolves a numeric field of the model to its type and both its bounds', () => {
    expect(resolveValue('profile.age', PLATFORM, MODEL)).toStrictEqual({
      type: 'integer',
      minimum: 13,
      maximum: 130,
    })
  })
  it('marks a read-only field of the model readOnly', () => {
    expect(resolveValue('profile.email', PLATFORM, MODEL)).toStrictEqual({
      type: 'string',
      format: 'email',
      readOnly: true,
    })
    expect(resolveValue('profile.name', PLATFORM, MODEL)).not.toHaveProperty('readOnly')
  })
  it('leaves out a format of the model no value names', () => {
    expect(resolveValue('profile.created_at', PLATFORM, MODEL)).toEqual({
      type: 'string',
      readOnly: true,
    })
  })
  it('keeps an enum of strings or numbers of the model, and leaves one of other members out whole', () => {
    expect(resolveValue('profile.theme', PLATFORM, MODEL)).toStrictEqual({
      enum: ['light', 'dark'],
    })
    expect(resolveValue('profile.open', PLATFORM, MODEL)).toStrictEqual({})
  })
  it('is undefined for a ref that names no value and no field', () => {
    for (const ref of ['phone', 'profile.height', 'team.name']) {
      expect(resolveValue(ref, PLATFORM, MODEL), ref).toBeUndefined()
    }
    expect(resolveValue('profile.name', PLATFORM, undefined)).toBeUndefined()
    expect(resolveValue('email', { ...PLATFORM, values: undefined }, MODEL)).toBeUndefined()
  })
})

describe('parameterValueOf', () => {
  it('gives a parameter the value it refers to', () => {
    expect(parameterValueOf('platform.sign-in', 'email', PLATFORM, MODEL)).toEqual(EMAIL)
    expect(parameterValueOf('platform.sign-up', 'name', PLATFORM, MODEL)).toEqual({
      type: 'string',
      minLength: 1,
      maxLength: 80,
    })
  })
  it('narrows the value by the keywords the parameter writes beside it', () => {
    expect(parameterValueOf('platform.sign-in', 'login', PLATFORM, MODEL)).toEqual({
      ...EMAIL,
      maxLength: 100,
    })
  })
  it('keeps the bound of the value against a keyword beside it that would widen it', () => {
    expect(parameterValueOf('platform.sign-in', 'alias', PLATFORM, MODEL)).toStrictEqual({
      ...EMAIL,
      minLength: 3,
    })
  })
  it("gives a paged action's size the action's sizes as its enum", () => {
    expect(parameterValueOf('platform.accounts.list', 'size', PLATFORM, MODEL)).toEqual({
      type: 'number',
      enum: [10, 25, 50],
    })
    expect(parameterValueOf('platform.accounts.list', 'page', PLATFORM, MODEL)).toEqual({
      type: 'number',
    })
  })
  it('gives a parameter with neither a value nor a constraint its type alone', () => {
    expect(parameterValueOf('platform.sign-in', 'remember', PLATFORM, MODEL)).toEqual({
      type: 'boolean',
    })
  })
  it('keeps the numeric bounds of a field of the model, for a model action and a platform reference', () => {
    expect(parameterValueOf('profile.updateProfile', 'age', PLATFORM, MODEL)).toStrictEqual({
      type: 'integer',
      minimum: 13,
      maximum: 130,
    })
    expect(parameterValueOf('platform.sign-up', 'age', PLATFORM, MODEL)).toStrictEqual({
      type: 'integer',
      minimum: 13,
      maximum: 120,
    })
  })
  it('gives a parameter of an action of the model the value of the field it sets', () => {
    expect(parameterValueOf('profile.updateProfile', 'name', PLATFORM, MODEL)).toEqual({
      type: 'string',
      minLength: 1,
      maxLength: 80,
    })
    expect(parameterValueOf('profile.updateProfile', 'id', PLATFORM, MODEL)).toEqual({})
  })
  it('gives an unknown action or parameter no constraint', () => {
    expect(parameterValueOf('platform.sign-out', 'email', PLATFORM, MODEL)).toEqual({})
    expect(parameterValueOf('platform.sign-in', 'phone', PLATFORM, MODEL)).toEqual({})
    expect(parameterValueOf('profile.updateProfile', 'name', PLATFORM, undefined)).toEqual({})
  })
})
