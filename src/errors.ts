/**
 * The numeric error codes of the specification (section 14). The values are those of the C ABI of hh-cpp.
 * The codes 12 (`buffer_too_small`) and 13 (`out_of_memory`) belong to caller-allocated buffers and do not
 * occur in this library.
 */
export const HhErrorCode = Object.freeze({
  /** The input has no bytes. */
  EMPTY_INPUT: 1,
  /** The input is longer than 1 048 576 bytes. */
  INPUT_TOO_LARGE: 2,
  /** The string is not an even, non-zero number of hexadecimal digits with an optional `0x`. */
  INVALID_HEX: 3,
  /** The key is not 32 bytes, is all zero, or was closed. */
  INVALID_KEY: 4,
  /** The base digest is not 32 bytes. */
  INVALID_DIGEST: 5,
  /** The fingerprint is not 32 bytes or its mode is unknown. */
  INVALID_FINGERPRINT: 6,
  /** The image size is outside 16..1024 or leaves no room for the cells. */
  INVALID_SIZE: 7,
  /** The frame style is not allowed for the shape or the mode. */
  INVALID_FRAME: 8,
  /** The opaque background is too close to a palette colour. */
  LOW_CONTRAST: 9,
  /** The JPEG quality is outside 50..100. */
  INVALID_QUALITY: 10,
  /** The image dimensions or its buffer length are invalid. */
  INVALID_IMAGE: 11,
  /**
   * A value of the wrong type, an unknown option name, a colour or an alpha out of range, or a text with
   * an unpaired surrogate.
   */
  INVALID_ARGUMENT: 14,
} as const);

/** One of the numeric values of {@link HhErrorCode}. */
export type HhErrorCode = (typeof HhErrorCode)[keyof typeof HhErrorCode];

/** The name of an error code as the specification and the golden vectors spell it. */
export type HhErrorName =
  | "empty_input"
  | "input_too_large"
  | "invalid_hex"
  | "invalid_key"
  | "invalid_digest"
  | "invalid_fingerprint"
  | "invalid_size"
  | "invalid_frame"
  | "low_contrast"
  | "invalid_quality"
  | "invalid_image"
  | "invalid_argument";

const NAMES: Readonly<Record<HhErrorCode, HhErrorName>> = Object.freeze({
  1: "empty_input",
  2: "input_too_large",
  3: "invalid_hex",
  4: "invalid_key",
  5: "invalid_digest",
  6: "invalid_fingerprint",
  7: "invalid_size",
  8: "invalid_frame",
  9: "low_contrast",
  10: "invalid_quality",
  11: "invalid_image",
  14: "invalid_argument",
});

/**
 * Thrown for invalid arguments. It carries the error of the specification as a number ({@link code}) and
 * as a name ({@link specName}); the message is an English text for logs and may change between releases.
 * The functions that take outside data (inputs, keys, stored bytes, sizes, pixels) have `...OrNull`
 * companions that return `null` instead.
 *
 * ```ts
 * try {
 *   BaseDigest.ofHex(pasted);
 * } catch (e) {
 *   if (e instanceof HhError && e.code === HhErrorCode.INVALID_HEX) { ... }
 * }
 * ```
 */
export class HhError extends Error {
  /** The numeric code of the specification, one of {@link HhErrorCode}. */
  readonly code: HhErrorCode;

  /** The name of the code as the specification spells it, for example `"invalid_hex"`. */
  readonly specName: HhErrorName;

  /** Creates the error for `code`. */
  constructor(code: HhErrorCode, message: string) {
    super(message);
    this.name = "HhError";
    this.code = code;
    this.specName = NAMES[code];
  }
}

/** Runs `block` and maps an {@link HhError} to `null`; anything else is rethrown. */
export function orNull<T>(block: () => T): T | null {
  try {
    return block();
  } catch (e) {
    if (e instanceof HhError) {
      return null;
    }
    throw e;
  }
}
