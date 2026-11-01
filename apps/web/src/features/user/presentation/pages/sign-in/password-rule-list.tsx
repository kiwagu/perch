import { CircleCheckIcon, CircleIcon } from 'lucide-react'

import { useT } from '@workspace/i18n'
import { checkPasswordRules, type PasswordRule } from '@workspace/kernel'

export interface PasswordRuleListProps {
  /** The id the password input names the list by, as its description. */
  readonly id: string
  /** The password as typed: each rule it keeps is marked. */
  readonly password: string
}

/**
 * The rules of a new password under the password at sign-up, each marked `met` while the password
 * as typed keeps it (the kernel's rules, the gateway's too). The marks show what is typed; they
 * decide nothing. A screen reader reads each rule with whether it is met, the icons left out.
 *
 * The list is a hint, so it is smaller and quieter than the fields: a rule kept shows in the
 * success tone with a check, one not kept yet stays muted with an empty circle, never red, since
 * a rule not kept while typing is no error.
 */
export function PasswordRuleList(props: PasswordRuleListProps) {
  const t = useT()
  const kept = checkPasswordRules(props.password)
  const rules: readonly { rule: PasswordRule; testId: string; text: string }[] = [
    {
      rule: 'length',
      testId: 'user.sign-in.password-rule-list.length-item',
      text: t('user.sign-in.password-rule.length'),
    },
    {
      rule: 'characters',
      testId: 'user.sign-in.password-rule-list.characters-item',
      text: t('user.sign-in.password-rule.characters'),
    },
    {
      rule: 'digit',
      testId: 'user.sign-in.password-rule-list.digit-item',
      text: t('user.sign-in.password-rule.digit'),
    },
    {
      rule: 'uppercase',
      testId: 'user.sign-in.password-rule-list.uppercase-item',
      text: t('user.sign-in.password-rule.uppercase'),
    },
    {
      rule: 'lowercase',
      testId: 'user.sign-in.password-rule-list.lowercase-item',
      text: t('user.sign-in.password-rule.lowercase'),
    },
    {
      rule: 'symbol',
      testId: 'user.sign-in.password-rule-list.symbol-item',
      text: t('user.sign-in.password-rule.symbol'),
    },
  ]

  return (
    <ul
      id={props.id}
      className="flex flex-col gap-0.5 text-xs leading-tight"
      data-testid="user.sign-in.password-rule-list"
    >
      {rules.map(({ rule, testId, text }) => (
        <li
          key={rule}
          className={`flex items-start gap-1.5 ${kept[rule] ? 'text-success' : 'text-muted-foreground'}`}
          data-testid={testId}
          data-state={kept[rule] ? 'met' : undefined}
        >
          {kept[rule] ? (
            <CircleCheckIcon aria-hidden="true" className="size-3.5 shrink-0" />
          ) : (
            <CircleIcon aria-hidden="true" className="size-3.5 shrink-0" />
          )}
          <span>{text}</span>
          <span className="sr-only">
            {t(
              kept[rule] ? 'user.sign-in.password-rule.met' : 'user.sign-in.password-rule.not-met',
            )}
          </span>
        </li>
      ))}
    </ul>
  )
}
