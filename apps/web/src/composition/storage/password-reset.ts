import type { KeyValueStorage } from './key-value'

/** The key the tab that set a new password through a reset link writes, for the other tabs. */
export const PASSWORD_RESET_KEY = 'perch.password.reset'

/**
 * Tells the other tabs of this browser that a new password was set here through a reset link:
 * the value is new on every write, so each reset changes the key, which they hear. It names no
 * account, as the reset's answer names none.
 */
export function savePasswordReset(storage: KeyValueStorage): void {
  storage.set(PASSWORD_RESET_KEY, crypto.randomUUID())
}
