import { isDeepEqual } from 'remeda'

/** An immutable object defined only by its value. */
export abstract class ValueObject<T> {
  protected constructor(protected readonly value: Readonly<T>) {}

  unpack(): Readonly<T> {
    return this.value
  }

  equals(other: ValueObject<T>): boolean {
    return other.constructor === this.constructor && isDeepEqual(other.value, this.value)
  }
}
