import type { ResultAsync } from 'neverthrow'
import { assertEvent, emit, fromPromise, setup } from 'xstate'

import type { DataError } from '@workspace/data'
import type { DeviceSessionId } from '@workspace/ids'

import { failureOf, settled } from '../../../platform/actor-outcome'

/** The events of the screen's flow: the anchors acted on, with what their actions take. */
export type DevicesEvent =
  | { readonly type: 'device.list.revoke-button'; readonly device: DeviceSessionId }
  | { readonly type: 'device.everywhere.open-button' }
  | { readonly type: 'device.everywhere.dialog.confirm-button' }
  | { readonly type: 'device.everywhere.dialog.cancel-button' }

/**
 * The params of the flow's effects: an anchor shows one of the codes; a list is read again; the
 * app moves to a path.
 */
interface ShowParams {
  readonly anchor: string
  readonly codes: readonly string[]
}

interface ReadParams {
  readonly anchor: string
}

interface NavigateParams {
  readonly to: string
}

/** What the machine asks of its host: a code shown, the list read again, a move to a path. */
export type DevicesEmitted =
  | ({ readonly type: 'show' } & ShowParams)
  | ({ readonly type: 'read' } & ReadParams)
  | ({ readonly type: 'navigate' } & NavigateParams)

/** The page's writes: another device signed out, and every device, this one included. */
export interface DevicesMachineDeps {
  readonly revoke: (device: DeviceSessionId) => ResultAsync<unknown, DataError>
  readonly signOutEverywhere: () => ResultAsync<unknown, DataError>
}

/** The code of a write that could not reach the gateway. */
const OFFLINE = 'data:OFFLINE'

const ASKED = {
  type: 'show',
  params: { anchor: 'device.everywhere.dialog', codes: ['sign-out-everywhere'] },
} as const
const FAILED = {
  type: 'show',
  params: { anchor: 'app-shell.notice-message', codes: ['device-sign-out-failed'] },
} as const
const READ_DEVICES = { type: 'read', params: { anchor: 'device.list' } } as const
/** The toast the contract derives for another device signed out. */
const DEVICE_SIGNED_OUT = {
  type: 'show',
  params: { anchor: 'app-shell.toast', codes: ['device-signed-out'] },
} as const
const SIGNED_OUT = {
  type: 'show',
  params: { anchor: 'user.sign-in.notice-message', codes: ['signed-out-elsewhere'] },
} as const
const TO_SIGN_IN = { type: 'navigate', params: { to: '/sign-in' } } as const

/**
 * The devices page as the screen's flow says (`contract/domain/screens/devices.yaml`): another
 * device signs out from its row, every device after the dialog asked. A control is enabled while
 * a state handles its event (`snapshot.can`), the dialog is open while the flow is confirming.
 * Its `show`, `read` and `navigate` are emitted for the host: the shell's notice, the list read
 * again, the move to sign-in. A sign-out that could not reach the gateway reads nothing: that
 * read would fail too, and its notice would replace the one saying the sign-out failed.
 */
export function createDevicesMachine(deps: DevicesMachineDeps) {
  return setup({
    types: {
      events: {} as DevicesEvent,
      emitted: {} as DevicesEmitted,
    },
    actors: {
      'platform.devices.revoke': fromPromise<unknown, { readonly device: DeviceSessionId }>(
        ({ input }) => settled(deps.revoke(input.device)),
      ),
      'platform.sign-out-everywhere': fromPromise<unknown>(() => settled(deps.signOutEverywhere())),
    },
    guards: {
      gatewayOutOfReach: ({ event }) => failureOf(event, '') === OFFLINE,
    },
    actions: {
      show: emit((_, params: ShowParams) => ({ type: 'show' as const, ...params })),
      read: emit((_, params: ReadParams) => ({ type: 'read' as const, ...params })),
      navigate: emit((_, params: NavigateParams) => ({ type: 'navigate' as const, ...params })),
    },
  }).createMachine({
    id: 'device',
    initial: 'viewing',
    states: {
      viewing: {
        on: {
          'device.list.revoke-button': { target: 'signing-out' },
          'device.everywhere.open-button': { target: 'confirming', actions: [ASKED] },
        },
      },
      'signing-out': {
        invoke: {
          src: 'platform.devices.revoke',
          input: ({ event }) => {
            assertEvent(event, 'device.list.revoke-button')

            return { device: event.device }
          },
          onDone: { target: 'viewing', actions: [READ_DEVICES, DEVICE_SIGNED_OUT] },
          onError: [
            { target: 'viewing', guard: 'gatewayOutOfReach', actions: [FAILED] },
            { target: 'viewing', actions: [FAILED, READ_DEVICES] },
          ],
        },
      },
      confirming: {
        meta: { renders: ['device.everywhere.dialog'] },
        on: {
          'device.everywhere.dialog.confirm-button': { target: 'signing-out-everywhere' },
          'device.everywhere.dialog.cancel-button': { target: 'viewing' },
        },
      },
      'signing-out-everywhere': {
        invoke: {
          src: 'platform.sign-out-everywhere',
          onDone: { target: 'signed-out', actions: [SIGNED_OUT, TO_SIGN_IN] },
          onError: { target: 'viewing', actions: [FAILED] },
        },
      },
      'signed-out': { type: 'final' },
    },
  })
}
