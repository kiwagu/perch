import { cn } from 'cn'
import { EyeIcon, EyeOffIcon } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

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
 * (`show` while the input hides its value, `hide` while it shows it). It shows until the eye is
 * pressed again, whatever the person types or deletes, but a value the app gives that the person
 * did not just type (a flow emptying it once an action took it) hides it again, so what is typed
 * next is masked until the eye is pressed.
 */
export function PasswordInput({
  testId,
  showLabel,
  hideLabel,
  className,
  onChange,
  ...props
}: PasswordInputProps) {
  const [shown, setShown] = useState(false)
  // What the person typed last: a value the app holds that is not it is the app's own.
  const typed = useRef<InputProps['value']>(undefined)
  const { value } = props

  useEffect(() => {
    if (value !== undefined && value !== typed.current) {
      setShown(false)
    }
  }, [value])

  return (
    <div className="relative w-full">
      <Input
        {...props}
        onChange={(event) => {
          typed.current = event.target.value
          onChange?.(event)
        }}
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
