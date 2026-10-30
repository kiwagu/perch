import type { KeyValueStorage } from './key-value'

const SIGNING_OUT_KEY = 'perch.session.signing-out'

/** Tells every tab, those opened later included, that a sign-out began at `at` (epoch milliseconds). */
export function saveSigningOut(storage: KeyValueStorage, at: number): void {
  storage.set(SIGNING_OUT_KEY, String(at))
}

/** When the sign-out under way in this browser began; a kept value that is not a time is none. */
export function signingOutSince(storage: KeyValueStorage): number | undefined {
  const at = Number(storage.get(SIGNING_OUT_KEY) ?? Number.NaN)

  return Number.isFinite(at) ? at : undefined
}

export function forgetSigningOut(storage: KeyValueStorage): void {
  storage.remove(SIGNING_OUT_KEY)
}
