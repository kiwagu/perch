// Codes: a data-code attribute, a code key and a <NAME>_CODES map; domain codes are not read.
export const NOTICE_CODES = {
  saved: 'saved',
  failed: 'failed',
  other: 42,
  bus: 'bus:FAILED',
} as const

export const REFUSAL = { code: 'not-a-code', message: 'refused' }

export const DOMAIN = { code: 'note:TEXT_REQUIRED', message: 'the note is empty' }

export const WELCOME = { code: 'welcome' }

export function Codes(props: { readonly code: string }) {
  return (
    <div>
      <p data-code="saved" />
      <p data-code={'devices-read-failed'} />
      <p data-code={props.code} />
      <p data-code="Bad:Code" />
    </div>
  )
}
