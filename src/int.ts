// Integer arithmetic on JavaScript numbers.
//
// The specification is defined over integers, and a JavaScript number is an IEEE 754 double. A double holds
// every integer of magnitude up to 2^53 exactly, and a sum, a difference or a product of integers is exact
// as long as its result stays in that range. Every value of this library is an integer far below 2^53; the
// code that works on 32-bit words uses `| 0`, `>>> 0` and `Math.imul`, which are integer operations by
// definition.
//
// Division is the one operation that leaves the integers. `floorDiv` explains why flooring the double
// quotient is nevertheless exact. Divisions by a power of two are written as shifts.

/**
 * `floor(a / b)` for integers `0 <= a < 2^53` and `1 <= b < 2^53`.
 *
 * Let `a = n * b + r` with `0 <= r < b`, so that the real quotient is `q = n + r / b`. If `r = 0` the
 * quotient is an integer below 2^53 and the double division returns it exactly. Otherwise `q` is at least
 * `1 / b` below `n + 1`. The double division returns `q` rounded to 53 significant bits, which moves it by
 * at most `q * 2^-53`, and `q * 2^-53 <= (a / b) * 2^-53 < 1 / b` because `a < 2^53`. The rounded quotient
 * therefore stays below `n + 1`; it cannot fall below `n`, because `n` is a double and rounding is
 * monotonic. Its floor is `n`.
 *
 * Callers whose quotient fits 31 bits write the same division as `(a / b) | 0`.
 */
export function floorDiv(a: number, b: number): number {
  return Math.floor(a / b);
}
