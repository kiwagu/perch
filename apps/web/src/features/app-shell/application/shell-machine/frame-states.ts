/**
 * Each state of the frame's regions (`running`'s `screen` and `install`) as the partial state
 * value `snapshot.matches` and `stateIn` take: the one way the app names a region state.
 */
export const FRAME_STATES = {
  ready: { running: { screen: 'ready' } },
  crashed: { running: { screen: 'crashed' } },
  reloading: { running: { screen: 'reloading' } },
  updating: { running: { screen: 'updating' } },
  offering: { running: { install: 'offering' } },
  installing: { running: { install: 'installing' } },
  postponing: { running: { install: 'postponing' } },
} as const
