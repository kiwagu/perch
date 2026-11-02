/**
 * The names a stand's values (`settings.ts`) go by: the vars of the mcproc manifest that hold
 * each stand's, and the flags of `cli.ts` the manifest's gateway apps pass them in. `bun run dev`
 * reads the dev stand's vars from `mcproc --json describe`; `names.spec.ts` holds the manifest's
 * gateway apps to the same vars.
 */

import type { StandNames } from './settings.ts'

/** The manifest vars of each stand's values; the From and the auth secret are the stands' own. */
export const STAND_VARS = {
  dev: {
    surreal: 'surreal_dev',
    gateway: 'gateway',
    front: 'front',
    smtp: 'maildev_smtp',
    mailFrom: 'stand_mail_from',
    authSecret: 'stand_auth_secret',
  },
  e2e: {
    surreal: 'surreal_e2e',
    gateway: 'gateway_e2e',
    front: 'front_e2e',
    smtp: 'maildev_smtp_e2e',
    mailFrom: 'stand_mail_from',
    authSecret: 'stand_auth_secret',
  },
} as const satisfies Readonly<Record<string, StandNames>>

export type StandName = keyof typeof STAND_VARS

/** The flag of `cli.ts` that carries each of a stand's values, without its leading `--`. */
export const STAND_FLAGS = {
  surreal: 'surreal',
  gateway: 'gateway',
  front: 'front',
  smtp: 'smtp',
  mailFrom: 'mail-from',
  authSecret: 'auth-secret',
} as const satisfies StandNames
