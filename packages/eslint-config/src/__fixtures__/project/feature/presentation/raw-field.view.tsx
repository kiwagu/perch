export function RawFields(props: { readonly label: string }) {
  return (
    <div>
      <input aria-label={props.label} />
      <textarea aria-label={props.label} />
      <select aria-label={props.label} />
    </div>
  )
}
