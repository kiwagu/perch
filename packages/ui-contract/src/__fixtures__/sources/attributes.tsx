// Anchors on JSX attributes: literals, props, and values that pass through.
import { testIdFor } from '@workspace/ui-contract/anchors'

import { OptionSelect, ShellNav } from './parts'

export function Attributes(props: {
  readonly testId: string
  readonly anchors: { readonly list: string }
}) {
  return (
    <section data-testid="sample.page">
      <input data-testid={'sample.title-input'} />
      <button type="submit" data-testid={`sample.save-button`} />
      <OptionSelect testId="sample.mode-select" />
      <ShellNav navigationTestId="sample.home-link" />
      <ul data-testid={props.testId} />
      <ul data-testid={props.anchors.list} />
      <li data-testid={testIdFor(props.testId, 'item')} />
    </section>
  )
}
