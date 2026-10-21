// Codes: a data-code attribute, a code key and a <NAME>_CODES map.
export const NOTICE_CODES = { saved: 'saved', failed: 'failed', other: 42 } as const

export const REFUSAL = { code: 'not-a-code', message: 'refused' }

export function Codes(props: { readonly code: string }) {
  return (
    <div>
      <p data-code="saved" />
      <p data-code={'devices-read-failed'} />
      <p data-code={props.code} />
    </div>
  )
}
