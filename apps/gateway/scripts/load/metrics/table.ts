/** The cells of a report table line, each as wide as the header of its column. */
export function tableLine(columns: readonly string[], cells: readonly string[]): string {
  return cells.map((cell, i) => cell.padEnd(columns[i]?.length ?? 0)).join('  ')
}

/** A number with one decimal; `-` for one that is not a number. */
export function oneDecimal(value: number): string {
  return Number.isNaN(value) ? '-' : value.toFixed(1)
}
