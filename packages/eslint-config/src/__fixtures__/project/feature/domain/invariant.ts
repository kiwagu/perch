export class NegativeException extends Error {}

export function check(value: number): number {
  if (value < 0) {
    throw new NegativeException('negative')
  }

  return value
}
