/** A notice shown: its contract code and its text, already translated. */
export interface ShellNotice {
  readonly code: string
  readonly text: string
}

export interface NoticeLineProps {
  /** The notice shown; none leaves the line empty. */
  readonly notice?: ShellNotice | undefined
}

/**
 * The notice's line. It is held, as tall as the longest notice (three lines on a phone, two wider
 * up; `texts-contract.spec.ts` keeps every notice within it), so the page below does not move when
 * a notice comes, changes or goes.
 */
export function NoticeLine(props: NoticeLineProps) {
  return (
    <div data-slot="notice" className="min-h-15 sm:min-h-10">
      {props.notice ? (
        <p
          className="text-sm text-muted-foreground"
          role="status"
          data-testid="app-shell.notice-message"
          data-code={props.notice.code}
        >
          {props.notice.text}
        </p>
      ) : null}
    </div>
  )
}
