declare function t(key: string): string

export function Label(props: { readonly name: string }) {
  return <p>{t(`user.${props.name}`)}</p>
}
