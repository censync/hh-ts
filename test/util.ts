// Helpers shared by the tests. Tests run on Node.js and may use its modules; the library may not.

import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

/** The repository's `testdata/` directory, seen from the compiled tests in `build/test/`. */
export const TESTDATA = fileURLToPath(new URL("../../testdata/", import.meta.url));

/** Lowercase hex of the bytes. */
export function toHex(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("hex");
}

/** Bytes of an even-length hex string. */
export function fromHex(hex: string): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = Number.parseInt(hex.slice(2 * i, 2 * i + 2), 16);
  }
  return out;
}

/** US-ASCII bytes of the text. */
export function ascii(text: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(text, (c) => c.charCodeAt(0));
}

/** `count` copies of `value`. */
export function repeatByte(value: number, count: number): Uint8Array<ArrayBuffer> {
  return new Uint8Array(count).fill(value);
}

/** SHA-256 by the platform, as lowercase hex. */
export function sha256Hex(...parts: Uint8Array[]): string {
  const hash = createHash("sha256");
  for (const part of parts) {
    hash.update(part);
  }
  return hash.digest("hex");
}

/**
 * The generator of SPEC.md section 15: `x = (x * 1103515245 + 12345) mod 2^31`, one byte per step. It
 * makes the test images of the vectors and drives the deterministic pseudo-random tests.
 */
export class Lcg {
  private x: number;

  constructor(seed: number) {
    this.x = seed;
  }

  /** The next byte: `floor(x / 2^16) mod 256`. */
  nextByte(): number {
    // Math.imul multiplies modulo 2^32; the mask then gives the value modulo 2^31.
    this.x = (Math.imul(this.x, 1103515245) + 12345) & 0x7fffffff;
    return (this.x >>> 16) & 0xff;
  }

  /** `count` bytes. */
  nextBytes(count: number): Uint8Array<ArrayBuffer> {
    const out = new Uint8Array(count);
    for (let i = 0; i < count; i++) {
      out[i] = this.nextByte();
    }
    return out;
  }

  /** An integer in `0..bound-1`, `bound` at most 2^24. The bias is irrelevant for tests. */
  nextInt(bound: number): number {
    const v = (this.nextByte() << 16) | (this.nextByte() << 8) | this.nextByte();
    return v % bound;
  }

  /** One element of `items`. */
  pick<T>(items: readonly T[]): T {
    return items[this.nextInt(items.length)] as T;
  }
}

/** The test image patterns of SPEC.md section 15: `flat:<RRGGBBAA>`, `noise:<seed>`, `opaque:<seed>`. */
export function pattern(name: string, width: number, height: number): Uint8Array<ArrayBuffer> {
  const colon = name.indexOf(":");
  const kind = name.slice(0, colon);
  const argument = name.slice(colon + 1);
  if (kind === "flat") {
    const value = fromHex(argument);
    const rgba = new Uint8Array(width * height * 4);
    for (let i = 0; i < rgba.length; i++) {
      rgba[i] = value[i % 4] as number;
    }
    return rgba;
  }
  const rgba = new Lcg(Number.parseInt(argument, 10)).nextBytes(width * height * 4);
  if (kind === "opaque") {
    for (let i = 3; i < rgba.length; i += 4) {
      rgba[i] = 0xff;
    }
  }
  return rgba;
}
