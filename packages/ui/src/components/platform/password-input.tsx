import { cn } from 'cn'
import { EyeIcon, EyeOffIcon } from 'lucide-react'
import { useState } from 'react'

import { Button } from '@workspace/ui/components/ui/button'
import { Input, type InputProps } from '@workspace/ui/components/ui/input'
import { testIdFor } from '@workspace/ui-contract/anchors'

export interface PasswordInputProps extends Omit<InputProps, 'type'> {
  /** The input's anchor; its eye carries `<testId>.visibility-button`. */
  readonly testId: string
  /** The eye's accessible name while the input hides what it holds: a click shows it. */
  readonly showLabel: string
  /** The eye's accessible name while the input shows what it holds: a click hides it. */
  readonly hideLabel: string
}

/**
 * A password input with its eye beside it, which shows what the input holds as typed or hides it
 * again. Whether it shows is the input's own: presentation only, never an event of a flow, so the
 * eye is always enabled, the input disabled or not, and its `data-value` names what a click does
 * (`show` while the input hides its value, `hide` while it shows it).
 */
export function PasswordInput({
  testId,
  showLabel,
  hideLabel,
  className,
  ...props
}: PasswordInputProps) {
  const [shown, setShown] = useState(false)

  return (
    <div className="relative w-full">
      <Input
        {...props}
        type={shown ? 'text' : 'password'}
        className={cn('pr-11', className)}
        data-testid={testId}
      />
      <Button
        type="button"
        variant="ghost"
        className="absolute inset-y-0 right-0 h-full w-11 rounded-l-none text-muted-foreground"
        aria-label={shown ? hideLabel : showLabel}
        aria-pressed={shown}
        onClick={() => setShown((now) => !now)}
        data-testid={testIdFor(testId, 'visibility-button')}
        data-value={shown ? 'hide' : 'show'}
      >
        {shown ? <EyeOffIcon aria-hidden="true" /> : <EyeIcon aria-hidden="true" />}
      </Button>
    </div>
  )
}
