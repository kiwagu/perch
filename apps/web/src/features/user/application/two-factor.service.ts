import { ResultAsync } from 'neverthrow'

import type { BusError } from '@workspace/cqrs'
import type { DataError } from '@workspace/data'
import { token } from '@workspace/di'
import type { TwoFactorId } from '@workspace/ids'

import type { TwoFactorEnrolment, TwoFactorPort } from '../../../platform/two-factor.port'

import { secondFactorCode } from './second-factor-code.policy'

export type TwoFactorError = DataError | BusError

/**
 * What turning the second factor on starts, as the page shows it: the gateway's answer and the QR
 * code of its key as an SVG, or none when the QR could not be drawn (the key to type still shows).
 */
export interface TwoFactorStart extends TwoFactorEnrolment {
  readonly qr: string | undefined
}

/**
 * The signed-in account's second factor through the gateway: whether it is on, turning it on
 * (the key, its QR and ten backup codes first, a code of the key then confirms), turning it off
 * and renewing the codes. Each change confirms the account's password at the gateway.
 */
export class TwoFactorService {
  constructor(
    private readonly factor: TwoFactorPort,
    /** Draws the QR code of an address as an SVG; rejects when it cannot. */
    private readonly draw: (uri: string) => Promise<string>,
  ) {}

  /** Whether the second factor is on. */
  read(): ResultAsync<boolean, DataError> {
    return this.factor.read().map(({ enabled }) => enabled)
  }

  /**
   * Starts turning it on: the key, ten backup codes and the enrolment a code confirms, with the
   * QR of the key. The QR is drawn only for a start the gateway answered; one that cannot be
   * drawn leaves `qr` out and does not fail the start, since the key shows as text too.
   */
  enable(password: string): ResultAsync<TwoFactorStart, DataError> {
    return this.factor.enable(password).andThen((enrolment) =>
      ResultAsync.fromSafePromise(
        this.draw(enrolment.uri).then(
          (qr) => ({ ...enrolment, qr }),
          () => ({ ...enrolment, qr: undefined }),
        ),
      ),
    )
  }

  /**
   * Turns it on with a code the key shows now, for the start `enrolment` names. A code of no
   * length the contract allows is no code: it fails as `sign-in:CODE_INVALID` before the gateway
   * is asked; within those bounds the gateway judges it (`data:INVALID_CODE`).
   */
  confirm(code: string, enrolment: TwoFactorId): ResultAsync<void, TwoFactorError> {
    return secondFactorCode(code).asyncAndThen((valid) => this.factor.confirm(valid, enrolment))
  }

  /** Turns it off, its key and its codes with it. */
  disable(password: string): ResultAsync<void, DataError> {
    return this.factor.disable(password)
  }

  /** Replaces the backup codes: the ten new ones, shown once. */
  renewCodes(password: string): ResultAsync<readonly string[], DataError> {
    return this.factor.renewCodes(password).map(({ backupCodes }) => backupCodes)
  }
}

export const TWO_FACTOR_SERVICE = token<TwoFactorService>('TwoFactorService')
