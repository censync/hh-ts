import { keyCheckValue, keyedFingerprint } from "./derive.js";
import { HhError, HhErrorCode, orNull } from "./errors.js";
import { copyOfSize } from "./model.js";

/**
 * The 32-byte secret of keyed mode. The key must be uniformly random or the output of a key derivation
 * function: there is no passphrase form.
 *
 * {@link SecretKey.close} overwrites the library's copy of the bytes with zeros; close the key in a
 * `finally` block or when the wallet locks. This is as far as JavaScript goes: the engine may have
 * copied the bytes while it moved or optimised the array, and nothing can be said about the memory of
 * the caller's own array, of strings the key was decoded from, or of a garbage-collected heap in
 * general. Hosts that must not have the key in the JavaScript heap compute the keyed fingerprint
 * elsewhere and pass the result to `Fingerprint.fromBytes`.
 *
 * The bytes are held in a private field: they do not show up in `console.log`, in `JSON.stringify` or in
 * a debugger's property list of the object.
 *
 * The key check value is public. It is computed when the key is created and stays readable after the key
 * is closed; every other use of a closed key fails with `invalid_key`.
 */
export class SecretKey {
  /** The size of a key in bytes. */
  static readonly SIZE = 32;

  readonly #bytes: Uint8Array<ArrayBuffer>;
  readonly #checkValue: Uint8Array<ArrayBuffer>;
  #closed = false;

  private constructor(bytes: Uint8Array<ArrayBuffer>) {
    this.#bytes = bytes;
    this.#checkValue = keyCheckValue(bytes);
    Object.freeze(this);
  }

  /**
   * The key check value: 4 bytes a host stores beside its cached data to notice that the key, and with it
   * every keyed picture, changed. It is public and can be read after the key was closed. Every call
   * returns a new array.
   */
  get checkValue(): Uint8Array<ArrayBuffer> {
    return this.#checkValue.slice();
  }

  /** True once {@link SecretKey.close} was called. */
  get closed(): boolean {
    return this.#closed;
  }

  /**
   * Wipes the key. Closing twice is harmless; a closed key still gives its {@link SecretKey.checkValue}
   * and throws `invalid_key` when a fingerprint is asked of it.
   */
  close(): void {
    this.#closed = true;
    this.#bytes.fill(0);
  }

  /** `SecretKey(***)`: the bytes are never printed. */
  toString(): string {
    return "SecretKey(***)";
  }

  /**
   * Accepts exactly 32 bytes that are not all zero. The bytes are copied; wipe your own array.
   *
   * @throws {@link HhError} with `invalid_key`.
   */
  static of(bytes32: Uint8Array): SecretKey {
    const bytes = copyOfSize(bytes32, SecretKey.SIZE);
    if (bytes === undefined) {
      throw new HhError(HhErrorCode.INVALID_KEY, `a key is a Uint8Array of ${SecretKey.SIZE} bytes`);
    }
    let bits = 0;
    for (let i = 0; i < bytes.length; i++) {
      bits |= bytes[i];
    }
    if (bits === 0) {
      throw new HhError(HhErrorCode.INVALID_KEY, "the all-zero key is not a key");
    }
    return new SecretKey(bytes);
  }

  /** {@link SecretKey.of}, or `null` instead of an exception. */
  static ofOrNull(bytes32: Uint8Array): SecretKey | null {
    return orNull(() => SecretKey.of(bytes32));
  }

  /**
   * The bytes of the keyed fingerprint of the base digest `s` under `key`: `Fingerprint.keyed` without the
   * wrappers. A key is an object that came out of the constructor of this class, which `instanceof` does
   * not tell.
   *
   * @throws {@link HhError} with `invalid_key` if `key` is not an open {@link SecretKey}.
   * @internal
   */
  static keyedFingerprint(key: SecretKey, s: Uint8Array): Uint8Array<ArrayBuffer> {
    if (typeof key !== "object" || key === null || !(#bytes in key)) {
      throw new HhError(HhErrorCode.INVALID_KEY, "the key is not a SecretKey");
    }
    if (key.#closed) {
      throw new HhError(HhErrorCode.INVALID_KEY, "the key was closed");
    }
    return keyedFingerprint(key.#bytes, s);
  }
}
