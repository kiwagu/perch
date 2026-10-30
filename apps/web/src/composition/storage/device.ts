import { deviceId } from '@workspace/replica/protocol'

import type { KeyValueStorage } from './key-value'

const DEVICE_KEY = 'perch.device.id'

/**
 * This browser's stable name, minted on first use; commands carry it in their context. A stored
 * value the protocol does not take as a device id (empty, too long) is replaced by a new one.
 */
export function deviceIdFrom(storage: KeyValueStorage): string {
  const saved = deviceId.safeParse(storage.get(DEVICE_KEY))

  if (saved.success) {
    return saved.data
  }

  const minted = crypto.randomUUID()

  storage.set(DEVICE_KEY, minted)

  return minted
}
