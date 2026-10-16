export { AggregateRoot } from './aggregate-root'
export {
  type DomainEvent,
  defineEvent,
  type EventDefinition,
  type EventMeta,
  type InvalidEventPayload,
} from './base-event'
export { Entity } from './entity'
export { ExceptionBase } from './exception'
export { applyRules, type DomainRule, type RuleViolation } from './rules'
export {
  type ChangeSpec,
  isSatisfiedBy,
  type QuerySpec,
  resolveValue,
  type Scalar,
  type ValueRef,
} from './spec'
export { byText, compareText } from './text'
export { ValueObject } from './value-object'
