/** A mark of an account, or of its role in an organisation: a word, its value when it has one. */
export function MarkBadge(props: {
  readonly testId: string
  /** The choice the mark stands for (`data-value`), when it is one. */
  readonly value?: string
  readonly children: string
}) {
  return (
    <span
      className="rounded-md bg-muted px-2 py-0.5 text-xs text-muted-foreground"
      data-testid={props.testId}
      {...(props.value === undefined ? {} : { 'data-value': props.value })}
    >
      {props.children}
    </span>
  )
}
