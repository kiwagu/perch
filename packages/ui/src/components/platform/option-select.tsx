import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@workspace/ui/components/ui/select'
import { testIdFor } from '@workspace/ui-contract/anchors'

export interface Option<Value extends string> {
  readonly value: Value
  readonly label: string
}

export interface OptionSelectProps<Value extends string> {
  readonly label: string
  readonly value: Value
  readonly options: readonly Option<Value>[]
  readonly onChange: (value: Value) => void
  /** The trigger's anchor, carrying the chosen value as `data-value`; each option carries `<testId>.option` with its value as `data-value`. */
  readonly testId?: string
  /** Takes no choice: the trigger cannot be opened. */
  readonly disabled?: boolean
  /** False for a choice that applies at once, as the contract derives for it. */
  readonly holdsInput?: boolean
}

/** A labelled choice between a few options; the trigger shows the chosen label from the first render. */
export function OptionSelect<Value extends string>(props: OptionSelectProps<Value>) {
  const optionTestId = props.testId === undefined ? undefined : testIdFor(props.testId, 'option')

  return (
    <Select
      items={props.options.map((option) => ({ value: option.value, label: option.label }))}
      value={props.value}
      disabled={props.disabled}
      holdsInput={props.holdsInput}
      onValueChange={(value) => {
        if (value !== null) {
          props.onChange(value as Value)
        }
      }}
    >
      <SelectTrigger
        aria-label={props.label}
        data-testid={props.testId}
        data-value={props.value}
        className="min-h-11 text-base"
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {props.options.map((option) => (
          <SelectItem
            key={option.value}
            value={option.value}
            className="min-h-11"
            data-testid={optionTestId}
            data-value={option.value}
          >
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
