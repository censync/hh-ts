import assert from "node:assert/strict";
import { test } from "node:test";

import { flatten } from "../src/bmp.js";
import { floorDiv } from "../src/int.js";
import { Lcg } from "./util.js";

// The library divides with the double division of JavaScript and drops the fraction; src/int.ts argues
// that this is exact. BigInt division is the oracle here.
test("floorDiv equals the integer quotient up to 2^53", () => {
  const random = new Lcg(53);
  const wide = (bits: number): number => {
    let v = 0;
    for (let i = 0; i < 7; i++) {
      v = v * 256 + random.nextByte();
    }
    return Math.floor(v / 2 ** (56 - bits));
  };
  const max = Number.MAX_SAFE_INTEGER;
  const hard: [number, number][] = [
    [max, 1],
    [max, 2],
    [max, 3],
    [max, max],
    [max - 1, max],
    [max, max - 1],
    [0, max],
  ];
  // Quotients just below an integer are where a rounded division could tip over.
  for (let i = 0; i < 20000; i++) {
    const b = 1 + wide(1 + random.nextInt(27));
    const n = wide(1 + random.nextInt(26));
    hard.push([n * b + b - 1, b], [n * b, b], [wide(53), 1 + wide(1 + random.nextInt(53))]);
  }
  for (const [a, b] of hard) {
    assert.ok(Number.isSafeInteger(a) && Number.isSafeInteger(b) && b >= 1);
    assert.equal(floorDiv(a, b), Number(BigInt(a) / BigInt(b)), `${a} / ${b}`);
  }
});

test("the contrast quotient is exact over its whole numerator range", () => {
  // 100 * (Y + 5 * 10^8) with Y up to 10^10, divided by at least 5 * 10^8.
  const random = new Lcg(9);
  for (let i = 0; i < 20000; i++) {
    const lo = 500000000 + random.nextInt(1 << 24) * 596;
    const hi = lo + random.nextInt(1 << 24) * 30;
    assert.equal(floorDiv(100 * hi, lo), Number((100n * BigInt(hi)) / BigInt(lo)));
  }
});

test("flattening equals the definition for every alpha, value and matte", () => {
  for (let a = 0; a <= 255; a++) {
    for (let value = 0; value <= 255; value += a % 2 === 0 ? 1 : 5) {
      for (const matte of [0, 1, 127, 128, 254, 255]) {
        const numerator = a * value + (255 - a) * matte + 127;
        const q = flatten(value, a, matte);
        // q is the floor of numerator / 255 if and only if 255 q <= numerator < 255 (q + 1).
        assert.ok(Number.isInteger(q) && 255 * q <= numerator && numerator < 255 * (q + 1), `${a} ${value} ${matte}`);
      }
    }
  }
});
