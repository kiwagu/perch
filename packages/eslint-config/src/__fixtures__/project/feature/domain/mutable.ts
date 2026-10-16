export function total(items: readonly number[]): number {
  let sum = 0

  for (const item of items) {
    sum += item
  }

  return sum
}
