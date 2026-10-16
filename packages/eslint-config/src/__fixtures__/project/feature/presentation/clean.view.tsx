declare function t(key: string): string

export function Notice(props: { readonly saved: boolean }) {
  const label = t(props.saved ? 'user.profile.saved' : 'user.profile.save')

  return (
    <p className="text-sm" data-testid="user.profile.notice" title={t('user.profile.hint')}>
      {label}
    </p>
  )
}
