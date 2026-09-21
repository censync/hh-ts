import { KIND_BINARY, KIND_TEXT, baseDigest, checkInputLength, decodeHex, encodeHex } from "./derive.js";
import { HhError, HhErrorCode, orNull } from "./errors.js";
import { byteCount, copyOfSize, isBytes, sameBytes } from "./model.js";
import { encodeUtf8, measureUtf8 } from "./utf8.js";

/**
 * The base digest of an input: its stretched, public 32-byte value (section 4 of the specification).
 *
 * It is the only slow step, about 16 000 HMAC calls, so hosts compute it once per address, off the UI
 * thread where it matters, and cache {@link BaseDigest.toBytes}; both modes and any key derive their
 * fingerprint from it cheaply. It is public and needs no protection.
 *
 * A digest is immutable: the object is frozen and its bytes are reached through {@link BaseDigest.toBytes}
 * only, which returns a copy.
 */
export class BaseDigest {
  /** The size of a base digest in bytes. */
  static readonly SIZE = 32;

  readonly #bytes: Uint8Array<ArrayBuffer>;

  private constructor(bytes: Uint8Array<ArrayBuffer>) {
    this.#bytes = bytes;
    Object.freeze(this);
  }

  /** A copy of the 32 bytes, for caching; restore with {@link BaseDigest.fromBytes}. */
  toBytes(): Uint8Array<ArrayBuffer> {
    return this.#bytes.slice();
  }

  /** True if `other` is a base digest with the same bytes. */
  equals(other: unknown): boolean {
    return BaseDigest.#made(other) && sameBytes(this.#bytes, other.#bytes);
  }

  /**
   * A copy of the bytes of `value` if it is a base digest the library made, otherwise `undefined`. An
   * object that merely has the prototype of the class holds no bytes and is not one.
   *
   * @internal
   */
  static bytesOf(value: unknown): Uint8Array<ArrayBuffer> | undefined {
    return BaseDigest.#made(value) ? value.#bytes.slice() : undefined;
  }

  /** True if `value` came out of the constructor of this class, which `instanceof` does not tell. */
  static #made(value: unknown): value is BaseDigest {
    return typeof value === "object" && value !== null && #bytes in value;
  }

  /** `BaseDigest(<hex>)`. */
  toString(): string {
    return `BaseDigest(${encodeHex(this.#bytes)})`;
  }

  /**
   * Binary input: the bytes of an address, a public key or a hash, 1 to 1 048 576 of them.
   *
   * @throws {@link HhError} with `empty_input` or `input_too_large`, or with `invalid_argument` if `data`
   * is not a `Uint8Array`.
   */
  static of(data: Uint8Array): BaseDigest {
    return new BaseDigest(baseDigest(KIND_BINARY, inputBytes(data)));
  }

  /**
   * Binary input given as hexadecimal text: an optional `0x` or `0X`, then an even, non-zero number of
   * hexadecimal digits of either case. Every spelling of one address gives the same digest.
   *
   * @throws {@link HhError} with `invalid_hex` or `input_too_large`, or with `invalid_argument` if `hex`
   * is not a string.
   */
  static ofHex(hex: string): BaseDigest {
    if (typeof hex !== "string") {
      throw new HhError(HhErrorCode.INVALID_ARGUMENT, "the input is not a string");
    }
    return new BaseDigest(baseDigest(KIND_BINARY, decodeHex(hex)));
  }

  /**
   * Text input: the UTF-8 encoding of `text`, verbatim. A text input and a binary input with the same
   * bytes give different digests.
   *
   * @throws {@link HhError} with `empty_input` or `input_too_large`, or with `invalid_argument` if
   * `text` is not a string or holds an unpaired surrogate, which has no UTF-8 encoding. The length is
   * checked first, with an unpaired surrogate counted as three bytes.
   */
  static ofText(text: string): BaseDigest {
    if (typeof text !== "string") {
      throw new HhError(HhErrorCode.INVALID_ARGUMENT, "the input is not a string");
    }
    // Every UTF-16 unit gives at least one byte, so an overlong text is refused before it is measured.
    checkInputLength(text.length);
    const measure = measureUtf8(text);
    checkInputLength(measure.length);
    if (!measure.wellFormed) {
      throw new HhError(HhErrorCode.INVALID_ARGUMENT, "the text holds an unpaired surrogate");
    }
    return new BaseDigest(baseDigest(KIND_TEXT, encodeUtf8(text, measure.length)));
  }

  /**
   * Text input that is already encoded: the UTF-8 bytes of a text, taken verbatim and not validated.
   * For a well-formed text it gives the digest of {@link BaseDigest.ofText}.
   *
   * @throws {@link HhError} with `empty_input` or `input_too_large`, or with `invalid_argument` if `utf8`
   * is not a `Uint8Array`.
   */
  static ofUtf8(utf8: Uint8Array): BaseDigest {
    return new BaseDigest(baseDigest(KIND_TEXT, inputBytes(utf8)));
  }

  /**
   * Restores a cached digest from its 32 bytes.
   *
   * @throws {@link HhError} with `invalid_digest` unless `bytes32` is a `Uint8Array` of 32 bytes.
   */
  static fromBytes(bytes32: Uint8Array): BaseDigest {
    const bytes = copyOfSize(bytes32, BaseDigest.SIZE);
    if (bytes === undefined) {
      throw new HhError(HhErrorCode.INVALID_DIGEST, `a base digest has ${BaseDigest.SIZE} bytes`);
    }
    return new BaseDigest(bytes);
  }

  /** {@link BaseDigest.of}, or `null` instead of an exception. */
  static ofOrNull(data: Uint8Array): BaseDigest | null {
    return orNull(() => BaseDigest.of(data));
  }

  /** {@link BaseDigest.ofHex}, or `null` instead of an exception. */
  static ofHexOrNull(hex: string): BaseDigest | null {
    return orNull(() => BaseDigest.ofHex(hex));
  }

  /** {@link BaseDigest.ofText}, or `null` instead of an exception. */
  static ofTextOrNull(text: string): BaseDigest | null {
    return orNull(() => BaseDigest.ofText(text));
  }

  /** {@link BaseDigest.ofUtf8}, or `null` instead of an exception. */
  static ofUtf8OrNull(utf8: Uint8Array): BaseDigest | null {
    return orNull(() => BaseDigest.ofUtf8(utf8));
  }

  /** {@link BaseDigest.fromBytes}, or `null` instead of an exception. */
  static fromBytesOrNull(bytes32: Uint8Array): BaseDigest | null {
    return orNull(() => BaseDigest.fromBytes(bytes32));
  }
}

/**
 * The library's own copy of an input. The limits are checked on the true length before anything is copied,
 * and the copy is what gets hashed, so an array whose `length` lies is hashed as the bytes it holds.
 */
function inputBytes(data: Uint8Array): Uint8Array<ArrayBuffer> {
  if (!isBytes(data)) {
    throw new HhError(HhErrorCode.INVALID_ARGUMENT, "the input is not a Uint8Array");
  }
  checkInputLength(byteCount(data));
  return new Uint8Array(data);
}
