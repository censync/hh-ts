// Canonicalisation and derivation: sections 3 and 4 of the specification. Internal to the library.

import { HhError, HhErrorCode } from "./errors.js";
import { HmacSha256 } from "./hmac.js";
import { pbkdf2HmacSha256 } from "./pbkdf2.js";
import { Sha256 } from "./sha256.js";

/** The PBKDF2 iteration count `c` of the base digest. */
export const STRETCH_ITERATIONS = 16384;

/** The largest input in bytes. */
export const MAX_INPUT_SIZE = 1048576;

/** The kind byte of a binary input. */
export const KIND_BINARY = 0x00;

/** The kind byte of a text input. */
export const KIND_TEXT = 0x01;

const STAGE_DIGEST = 0x01;
const STAGE_KEYED = 0x02;
const STAGE_KCV = 0x03;

/** The bytes of an ASCII string. */
function ascii(text: string): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) {
    out[i] = text.charCodeAt(i);
  }
  return out;
}

const DST = ascii("HumanizedHash");
const STRETCH_SALT = ascii("HumanizedHash/stretch");

/** `DST || 00 || stage`, followed by `extra` zero bytes for the caller to fill. */
function prefix(stage: number, extra: number): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(DST.length + 2 + extra);
  out.set(DST);
  out[DST.length + 1] = stage;
  return out;
}

/** M1 without the data: `DST || 00 || 01 || kind || u32be(length)`. */
export function m1Header(kind: number, length: number): Uint8Array<ArrayBuffer> {
  const header = prefix(STAGE_DIGEST, 5);
  const p = DST.length + 2;
  header[p] = kind;
  header[p + 1] = length >>> 24;
  header[p + 2] = length >>> 16;
  header[p + 3] = length >>> 8;
  header[p + 4] = length;
  return header;
}

/** Throws unless `length` is 1..{@link MAX_INPUT_SIZE}. */
export function checkInputLength(length: number): void {
  if (length === 0) {
    throw new HhError(HhErrorCode.EMPTY_INPUT, "the input has no bytes");
  }
  if (length > MAX_INPUT_SIZE) {
    throw new HhError(HhErrorCode.INPUT_TOO_LARGE, `the input is longer than ${MAX_INPUT_SIZE} bytes`);
  }
}

/** `d0 = SHA-256(M1)`. */
export function d0(kind: number, data: Uint8Array): Uint8Array<ArrayBuffer> {
  const hasher = new Sha256();
  return hasher.update(m1Header(kind, data.length)).update(data).finish();
}

/**
 * `s = PBKDF2-HMAC-SHA-256(d0, "HumanizedHash/stretch", iterations, 32)`. The library always uses
 * {@link STRETCH_ITERATIONS}; the benchmark passes other counts to show what the choice costs.
 */
export function stretch(digest0: Uint8Array, iterations: number): Uint8Array<ArrayBuffer> {
  return pbkdf2HmacSha256(digest0, STRETCH_SALT, iterations, 32);
}

/** The base digest `s` of an input; checks the length limits. */
export function baseDigest(kind: number, data: Uint8Array): Uint8Array<ArrayBuffer> {
  checkInputLength(data.length);
  return stretch(d0(kind, data), STRETCH_ITERATIONS);
}

/** `M2 = DST || 00 || 02 || s`. */
export function m2(s: Uint8Array): Uint8Array<ArrayBuffer> {
  const message = prefix(STAGE_KEYED, 32);
  message.set(s, DST.length + 2);
  return message;
}

/** `HMAC-SHA-256(key, M2)`. */
export function keyedFingerprint(key: Uint8Array, s: Uint8Array): Uint8Array<ArrayBuffer> {
  return HmacSha256.tag(key, m2(s));
}

/** The first 4 bytes of `HMAC-SHA-256(key, DST || 00 || 03)`. */
export function keyCheckValue(key: Uint8Array): Uint8Array<ArrayBuffer> {
  const tag = HmacSha256.tag(key, prefix(STAGE_KCV, 0));
  const out = tag.slice(0, 4);
  tag.fill(0);
  return out;
}

/** The value of a hexadecimal digit given as a UTF-16 code unit, or -1. */
function hexValue(unit: number): number {
  if (unit >= 0x30 && unit <= 0x39) {
    return unit - 0x30;
  }
  if (unit >= 0x61 && unit <= 0x66) {
    return unit - 0x61 + 10;
  }
  if (unit >= 0x41 && unit <= 0x46) {
    return unit - 0x41 + 10;
  }
  return -1;
}

/**
 * Decodes hexadecimal text as section 3 defines it. The syntax is checked before the length, so an
 * overlong string with a bad character is `invalid_hex`.
 */
export function decodeHex(hex: string): Uint8Array<ArrayBuffer> {
  let start = 0;
  if (hex.length >= 2 && hex[0] === "0" && (hex[1] === "x" || hex[1] === "X")) {
    start = 2;
  }
  const digits = hex.length - start;
  if (digits === 0 || (digits & 1) !== 0) {
    throw new HhError(HhErrorCode.INVALID_HEX, "not an even, non-zero number of hexadecimal digits");
  }
  for (let i = start; i < hex.length; i++) {
    if (hexValue(hex.charCodeAt(i)) < 0) {
      throw new HhError(HhErrorCode.INVALID_HEX, `not a hexadecimal digit at position ${i}`);
    }
  }
  const size = digits >>> 1;
  if (size > MAX_INPUT_SIZE) {
    throw new HhError(HhErrorCode.INPUT_TOO_LARGE, `the input is longer than ${MAX_INPUT_SIZE} bytes`);
  }
  const out = new Uint8Array(size);
  for (let i = 0; i < size; i++) {
    const p = start + 2 * i;
    out[i] = (hexValue(hex.charCodeAt(p)) << 4) | hexValue(hex.charCodeAt(p + 1));
  }
  return out;
}

const HEX_DIGITS = "0123456789abcdef";

/** Lowercase hexadecimal, for `toString` only. */
export function encodeHex(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i++) {
    out += HEX_DIGITS[bytes[i] >>> 4] + HEX_DIGITS[bytes[i] & 0x0f];
  }
  return out;
}
