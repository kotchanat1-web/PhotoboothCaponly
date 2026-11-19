/** PAY-1: price comes from the configured table only (BR-05 draft) — never computed or hard-coded. */
export function priceFor(qty: number, table: Record<string, number>): number {
  const price = table[String(qty)]
  if (!Number.isInteger(qty) || qty < 1 || price === undefined) {
    throw new Error(`No price configured for qty=${qty}`)
  }
  return price
}

/** Quantities the customer can pick, ascending. */
export function availableQtys(table: Record<string, number>): number[] {
  return Object.keys(table)
    .map(Number)
    .filter((n) => Number.isInteger(n) && n >= 1)
    .sort((a, b) => a - b)
}
