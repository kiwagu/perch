import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@workspace/ui/components/ui/select'

export interface Option<Value extends string> {
  readonly value: Value
  readonly label: string
}

export interface OptionSelectProps<Value extends string> {
  readonly label: string
  readonly value: Value
  readonly options: readonly Option<Value>[]
  readonly onChange: (value: Value) => void
  readonly testId?: string
}

/** A labelled choice between a few options; the trigger shows the chosen label from the first render. */
export function OptionSelect<Value extends string>(props: OptionSelectProps<Value>) {
  return (
    <Select
      items={props.options.map((option) => ({ value: option.value, label: option.label }))}
      value={props.value}
      onValueChange={(value) => {
        if (value !== null) {
          props.onChange(value as Value)
        }
      }}
    >
      <SelectTrigger
        aria-label={props.label}
        data-testid={props.testId}
        className="min-h-11 text-base"
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {props.options.map((option) => (
          <SelectItem key={option.value} value={option.value} className="min-h-11">
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
