// Anchors in object keys and named constants.
export const SAMPLE_LIST_TEST_ID = 'sample.list'

export const sampleListTestId = 'not.a-constant'

export const LINKS = [
  { to: '/sample', testId: 'sample.thing-item' },
  { to: '/other', testId: `sample.key-select` },
  { to: '/again', testId: SAMPLE_LIST_TEST_ID },
]

export function notify(show: (notice: { readonly testId: string }) => void, testId: string): void {
  show({ testId })
}
