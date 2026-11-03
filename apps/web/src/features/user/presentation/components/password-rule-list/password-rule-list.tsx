import { CircleCheckIcon, CircleIcon } from 'lucide-react'

import { useT } from '@workspace/i18n'
import { checkPasswordRules, type PasswordRule } from '@workspace/kernel'

/** One rule of the list, with the anchor its screen gives its item. */
export interface PasswordRuleItem {
  readonly rule: PasswordRule
  readonly testId: string
}

export interface PasswordRuleListProps {
  /** The id the password input names the list by, as its description. */
  readonly id: string
  /** The password as typed: each rule it keeps is marked. */
  readonly password: string
  /** The list's anchor on its screen. */
  readonly testId: string
  /** The rules in the order the list shows them, each with its item's anchor on the screen. */
  readonly items: readonly PasswordRuleItem[]
}

/** The words of each rule, by its literal key. */
const TEXTS: Readonly<Record<PasswordRule, (t: ReturnType<typeof useT>) => string>> = {
  length: (t) => t('user.password-rule.length'),
  characters: (t) => t('user.password-rule.characters'),
  digit: (t) => t('user.password-rule.digit'),
  uppercase: (t) => t('user.password-rule.uppercase'),
  lowercase: (t) => t('user.password-rule.lowercase'),
  symbol: (t) => t('user.password-rule.symbol'),
}

/**
 * The rules of a new password under the new password of a form (a sign-up, a reset, a change),
 * each marked `met` while the password as typed keeps it (the kernel's rules, the gateway's too).
 * The marks show what is typed; they decide nothing. A screen reader reads each rule with whether
 * it is met, the icons left out.
 *
 * The list is a hint, so it is smaller and quieter than the fields: a rule kept shows in the
 * success tone with a check, one not kept yet stays muted with an empty circle, never red, since
 * a rule not kept while typing is no error.
 */
export function PasswordRuleList(props: PasswordRuleListProps) {
  const t = useT()
  const kept = checkPasswordRules(props.password)

  return (
    <ul
      id={props.id}
      className="flex flex-col gap-0.5 text-xs leading-tight"
      data-testid={props.testId}
    >
      {props.items.map(({ rule, testId }) => (
        <li
          key={rule}
          className="flex items-start gap-1.5 text-muted-foreground data-[state=met]:text-success"
          data-testid={testId}
          data-state={kept[rule] ? 'met' : undefined}
        >
          {kept[rule] ? (
            <CircleCheckIcon aria-hidden="true" className="size-3.5 shrink-0" />
          ) : (
            <CircleIcon aria-hidden="true" className="size-3.5 shrink-0" />
          )}
          <span>{TEXTS[rule](t)}</span>
          <span className="sr-only">
            {t(kept[rule] ? 'user.password-rule.met' : 'user.password-rule.not-met')}
          </span>
        </li>
      ))}
    </ul>
  )
}
