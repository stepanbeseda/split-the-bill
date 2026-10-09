/** Converts a decimal amount to integer minor units, or NaN when it has more than 2 decimals. */
export function toMinor(amount: number): number {
  const m = amount * 100;
  const r = Math.round(m);
  return Math.abs(m - r) < 1e-6 ? r : NaN;
}

/**
 * Rounds each share to whole minor units so that the rounded shares add up to the rounded total
 * (largest remainder method). Nobody is ever off by more than one cent.
 */
export function roundShares(exact: number[]): number[] {
  const out = exact.map((x) => Math.floor(x + 1e-7));
  let left = Math.round(exact.reduce((a, b) => a + b, 0)) - out.reduce((a, b) => a + b, 0);
  exact
    .map((x, i) => [x - out[i], i] as const)
    .sort((a, b) => b[0] - a[0])
    .forEach(([, i]) => {
      if (left > 0) {
        out[i]++;
        left--;
      }
    });
  return out;
}
