// Anchors built at runtime: every one of them is a problem.
export function Runtime(props: { readonly screen: string; readonly open: boolean }) {
  return (
    <div>
      <span data-testid={`${props.screen}.title-input`} />
      {/* biome-ignore lint/style/useTemplate: the fixture concatenates on purpose */}
      <span data-testid={props.screen + '.save-button'} />
      <span data-testid={props.open ? 'sample.a-button' : 'sample.b-button'} />
      <span testId={props.screen.toUpperCase()} />
    </div>
  )
}

export const BUILT_TEST_ID = `${'sample'}.page`
