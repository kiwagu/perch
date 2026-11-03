import { token } from '@workspace/di'

/**
 * An event of the platform (`contract/domain/platform.yaml`, `events`) that reaches the machines
 * of the screens: a fact of this browser that no account owns, set in another of its tabs.
 * `platform.password-reset`: another tab set a new password through the link of a reset mail;
 * it names no account.
 */
export type PlatformEvent = { readonly type: 'platform.password-reset' }

/** Hears the platform's events that reach the screens, as they come, until the returned stop. */
export interface PlatformEventsPort {
  listen(listener: (event: PlatformEvent) => void): () => void
}

export const PLATFORM_EVENTS = token<PlatformEventsPort>('PlatformEvents')
