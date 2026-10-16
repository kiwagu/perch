export function check(value: number): number {
  if (value < 0) {
    throw new Error('negative')
  }

  return value
}
