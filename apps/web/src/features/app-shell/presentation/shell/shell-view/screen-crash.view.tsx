import { useT } from '@workspace/i18n'
import { Button } from '@workspace/ui/components/ui/button'

import type { ShellEvent } from '../../../application/shell-machine'

/** The open screen failed to render. */
export type CrashCode = 'screen-crashed'

export interface ScreenCrashProps {
  /** The code the crash message shows while the open screen failed to render; none otherwise. */
  readonly crash?: CrashCode | undefined
  /** Whether the frame's flow renders the reload in its state. */
  readonly reload: boolean
  /** Whether the frame's flow takes `event` now: the reload is enabled while it takes its press. */
  readonly can: (event: ShellEvent) => boolean
  readonly onReload?: (() => void) | undefined
}

/** In the screen's place: the message that it failed to render, and the reload. */
export function ScreenCrash(props: ScreenCrashProps) {
  const t = useT()

  return (
    <div className="flex flex-col gap-3">
      {props.crash ? (
        <p className="text-sm" data-testid="app-shell.crash-message" data-code={props.crash}>
          {t('app.shell.crash.screen-crashed')}
        </p>
      ) : null}
      {props.reload ? (
        <Button
          type="button"
          variant="outline"
          className="self-start"
          disabled={!props.can({ type: 'app-shell.reload-button' })}
          onClick={props.onReload}
          data-testid="app-shell.reload-button"
        >
          {t('app.shell.reload')}
        </Button>
      ) : null}
    </div>
  )
}
