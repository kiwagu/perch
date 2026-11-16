import type { FrameWrites } from '../../application/setting-writes'

import type { ShellFrame } from './shell-frame'

/** A setting of the account the frame follows: its language and its theme. */
export type FollowedSetting = keyof FrameWrites

/** The data event each followed setting reaches the frame's flow as. */
const EVENT_OF = {
  locale: { type: 'model.settings.locale' },
  theme: { type: 'model.settings.theme' },
} as const satisfies Record<FollowedSetting, { readonly type: string }>

/** The record with `stored` noted as the value of `setting` that arrived. */
const arrivedIn = (writes: FrameWrites, setting: FollowedSetting, stored: string): FrameWrites =>
  setting === 'locale'
    ? { ...writes, locale: writes.locale.arrived(stored) }
    : { ...writes, theme: writes.theme.arrived(stored) }

/**
 * Hands the frame's machine the stored value of one setting as its data event. A value this tab
 * neither stored nor has seen yet goes to the machine, and counts as seen, only while the state
 * the frame is in takes the event; in any other (the data still opening) it waits unseen, and
 * the caller hands it again once the frame's state changes. A value this tab saw or stored itself applies nothing: it is only noted as arrived, so
 * a write of this tab that came back is no longer on its way.
 */
export function deliverStored(
  frame: ShellFrame,
  setting: FollowedSetting,
  stored: string | undefined,
): void {
  if (stored === undefined) {
    return
  }

  const { actor, live } = frame
  const event = EVENT_OF[setting]
  const unseen = live.writes[setting].elsewhere(stored) !== undefined

  if (unseen) {
    if (!actor.getSnapshot().can(event)) {
      return
    }

    actor.send(event)
  }

  live.writes = arrivedIn(live.writes, setting, stored)
}
