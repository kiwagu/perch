/**
 * A platform that declares its values and a model with one entity, for the specs of the values:
 * an email value, the password of a sign-in and the stricter new password of a sign-up, the
 * parameters that refer to them, one that narrows its value, one of a paged action and one with a
 * type alone.
 */

import type { Model } from '../model'
import type { Platform } from '../screens'

export const EMAIL = { type: 'string', format: 'email', maxLength: 254 } as const

export const PASSWORD = { type: 'string', minLength: 1 } as const

export const NEW_PASSWORD = {
  type: 'string',
  minLength: 10,
  maxLength: 35,
  pattern: '^[!-~]+$',
} as const

export const PLATFORM: Platform = {
  values: {
    email: { ...EMAIL, description: 'An address of mail.', examples: ['ada@example.com'] },
    password: { ...PASSWORD, description: 'A password as an account keeps it.' },
    'new-password': { ...NEW_PASSWORD, description: 'A password a new account may choose.' },
  },
  actions: {
    'sign-in': {
      description: 'Signs this device in.',
      params: {
        email: { value: 'email', description: 'The email of the account.' },
        password: { value: 'password', description: 'The password of the account.' },
        login: { value: 'email', maxLength: 100, description: 'A short email.' },
        alias: { value: 'email', maxLength: 500, minLength: 3, description: 'A long email.' },
        remember: { type: 'boolean', description: 'Keep this device signed in.' },
      },
      result: 'this device is signed in',
      codes: ['failed'],
      changes: [],
    },
    'sign-up': {
      description: 'Creates an account.',
      params: {
        email: { value: 'email', description: 'The email of the new account.' },
        password: { value: 'new-password', description: 'The password of the new account.' },
        name: { value: 'profile.name', description: 'The name of its profile.' },
        age: { value: 'profile.age', maximum: 120, description: 'The age of its owner.' },
      },
      result: 'the account is created',
      codes: ['failed'],
      changes: [],
    },
    'accounts.list': {
      description: 'Reads a page of the accounts.',
      params: {
        q: { type: 'string', description: 'A part of the email.' },
        page: { type: 'number', description: 'The page.' },
        size: { type: 'number', description: 'The entries a page holds.' },
      },
      result: 'a page of the accounts',
      codes: ['failed'],
      changes: [],
      paged: { sizes: [10, 25, 50], default: 25 },
    },
  },
  reserved: ['app-shell.status'],
  status: { anchor: 'app-shell.status', states: ['ready'] },
}

export const MODEL: Model = {
  document: {},
  entities: {
    profile: {
      name: 'profile',
      table: 'profile',
      region: 'private',
      id: 'prf',
      actions: {
        updateProfile: { params: { id: '$id', name: 'name', age: 'age' }, changes: [] },
      },
      unique: [],
      index: [],
      fields: {
        name: { type: 'string', minLength: 1, maxLength: 80, readonly: false, crdt: 'text' },
        age: { type: 'integer', minimum: 13, maximum: 130, readonly: false, crdt: 'none' },
        email: { type: 'string', format: 'email', readonly: true },
        created_at: { type: 'string', format: 'date-time', readonly: true },
        theme: { enum: ['light', 'dark'], readonly: false, crdt: 'none' },
        open: { enum: [true, false], readonly: false, crdt: 'none' },
      },
    },
  },
}
