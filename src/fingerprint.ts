import { BaseDigest } from "./base-digest.js";
import { HhError, HhErrorCode, orNull } from "./errors.js";
import { FRAME_COLOUR, PALETTE, cellsOf, tagOf } from "./features.js";
import { HhImage } from "./image.js";
import { MODES, copyOfSize, isMode, sameBytes } from "./model.js";
import type { Layout, Mode } from "./model.js";
import type { RenderOptions } from "./options.js";
import { render } from "./raster.js";
import { SecretKey } from "./secret-key.js";

/**
 * 32 bytes and the mode they were derived in: everything a picture depends on.
 *
 * ```ts
 * const digest = BaseDigest.ofHex("0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed"); // slow: cache it
 * const image = Fingerprint.universal(digest).render(128);
 * const png = image.encodePng();
 * ```
 *
 * A fingerprint is immutable: the object is frozen, the mode and the tag are read-only and the bytes are
 * reached through {@link Fingerprint.toBytes} only, which returns a copy.
 */
export class Fingerprint {
  /** The size of a fingerprint in bytes. */
  static readonly SIZE = 32;

  readonly #bytes: Uint8Array<ArrayBuffer>;
  readonly #mode: Mode;

  private constructor(bytes: Uint8Array<ArrayBuffer>, mode: Mode) {
    this.#bytes = bytes;
    this.#mode = mode;
    Object.freeze(this);
  }

  /** The mode the bytes were derived in. */
  get mode(): Mode {
    return this.#mode;
  }

  /**
   * The 6-character Crockford Base32 tag, for example `K7QM2X`; hosts display it as `K7Q-M2X`. Text
   * allows a certain check where a picture does not.
   */
  get tag(): string {
    return tagOf(this.#bytes);
  }

  /** A copy of the 32 bytes. */
  toBytes(): Uint8Array<ArrayBuffer> {
    return this.#bytes.slice();
  }

  /** The cells, the palette and the mode, for hosts that draw vectors themselves. */
  layout(): Layout {
    return {
      mode: this.#mode,
      cells: cellsOf(this.#bytes),
      paletteRgb: PALETTE.slice(),
      frameRgb: FRAME_COLOUR,
    };
  }

  /**
   * Renders `size` x `size` pixels, 16..1024.
   *
   * @throws {@link HhError} with `invalid_argument` if an option is unknown or out of range, then with
   * `invalid_size`, `invalid_frame` or `low_contrast`, as section 6 of the specification defines.
   */
  render(size: number, options?: RenderOptions): HhImage {
    return HhImage.wrap(size, size, render(this.#bytes, this.#mode, size, options));
  }

  /** {@link Fingerprint.render}, or `null` instead of an exception. */
  renderOrNull(size: number, options?: RenderOptions): HhImage | null {
    return orNull(() => this.render(size, options));
  }

  /** True if `other` is a fingerprint with the same bytes and the same mode. */
  equals(other: unknown): boolean {
    return (
      typeof other === "object" &&
      other !== null &&
      #bytes in other &&
      this.#mode === other.#mode &&
      sameBytes(this.#bytes, other.#bytes)
    );
  }

  /** `Fingerprint(<mode>, <tag>)`. */
  toString(): string {
    return `Fingerprint(${this.#mode}, ${tagOf(this.#bytes)})`;
  }

  /**
   * The universal fingerprint is the base digest itself.
   *
   * @throws {@link HhError} with `invalid_digest` if `digest` is not a {@link BaseDigest}.
   */
  static universal(digest: BaseDigest): Fingerprint {
    return new Fingerprint(digestBytes(digest), "universal");
  }

  /**
   * The keyed fingerprint: one HMAC of the base digest under the key.
   *
   * @throws {@link HhError} with `invalid_digest` if `digest` is not a {@link BaseDigest}, or with
   * `invalid_key` if `key` is not a {@link SecretKey} or was closed.
   */
  static keyed(digest: BaseDigest, key: SecretKey): Fingerprint {
    return new Fingerprint(SecretKey.keyedFingerprint(key, digestBytes(digest)), "keyed");
  }

  /** {@link Fingerprint.keyed}, or `null` instead of an exception. */
  static keyedOrNull(digest: BaseDigest, key: SecretKey): Fingerprint | null {
    return orNull(() => Fingerprint.keyed(digest, key));
  }

  /**
   * For hosts that compute the keyed HMAC elsewhere, for example natively or inside a secure element:
   * takes the 32 fingerprint bytes and the mode they belong to.
   *
   * @throws {@link HhError} with `invalid_fingerprint` unless `bytes32` is a `Uint8Array` of 32 bytes
   * and `mode` is a {@link Mode}.
   */
  static fromBytes(bytes32: Uint8Array, mode: Mode): Fingerprint {
    const bytes = copyOfSize(bytes32, Fingerprint.SIZE);
    if (bytes === undefined) {
      throw new HhError(HhErrorCode.INVALID_FINGERPRINT, `a fingerprint has ${Fingerprint.SIZE} bytes`);
    }
    if (!isMode(mode)) {
      throw new HhError(HhErrorCode.INVALID_FINGERPRINT, `the mode is one of ${MODES.join(", ")}`);
    }
    return new Fingerprint(bytes, mode);
  }

  /** {@link Fingerprint.fromBytes}, or `null` instead of an exception. */
  static fromBytesOrNull(bytes32: Uint8Array, mode: Mode): Fingerprint | null {
    return orNull(() => Fingerprint.fromBytes(bytes32, mode));
  }
}

/** A copy of the bytes of `digest`. */
function digestBytes(digest: BaseDigest): Uint8Array<ArrayBuffer> {
  const bytes = BaseDigest.bytesOf(digest);
  if (bytes === undefined) {
    throw new HhError(HhErrorCode.INVALID_DIGEST, "the digest is not a BaseDigest");
  }
  return bytes;
}
