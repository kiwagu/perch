import { NegativeException } from './negative.exception'

export function check(value: number): number {
  if (value < 0) {
    throw new NegativeException('negative')
  }

  return value
}
