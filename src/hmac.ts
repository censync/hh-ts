import { BLOCK_SIZE, Sha256, compress, initialState } from "./sha256.js";

/**
 * HMAC-SHA-256 as specified in RFC 2104 and FIPS 198-1. Internal to the library.
 *
 * The key is processed once into the inner and the outer mid-state; the key bytes are not retained. Keys
 * longer than the block size are hashed first and shorter keys are zero-padded, as RFC 2104 specifies.
 */
export class HmacSha256 {
  /** The mid-state after absorbing `key XOR ipad`. */
  readonly innerState: Int32Array;

  /** The mid-state after absorbing `key XOR opad`. */
  readonly outerState: Int32Array;

  /** Absorbs `key`. */
  constructor(key: Uint8Array) {
    const keyBlock = new Uint8Array(BLOCK_SIZE);
    if (key.length > BLOCK_SIZE) {
      const hashed = Sha256.digest(key);
      keyBlock.set(hashed);
      hashed.fill(0);
    } else {
      keyBlock.set(key);
    }
    // The message schedule of these two compressions holds the key block; it is wiped with it.
    const schedule = new Int32Array(64);
    this.innerState = absorbPaddedKey(keyBlock, 0x36, schedule);
    this.outerState = absorbPaddedKey(keyBlock, 0x5c, schedule);
    schedule.fill(0);
    keyBlock.fill(0);
  }

  /** The 32-byte tag of the concatenation of `parts`. */
  tag(...parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
    const inner = new Sha256(this.innerState, BLOCK_SIZE);
    for (const part of parts) {
      inner.update(part);
    }
    const innerDigest = inner.finish();
    const outer = new Sha256(this.outerState, BLOCK_SIZE);
    const out = outer.update(innerDigest).finish();
    innerDigest.fill(0);
    inner.wipe();
    outer.wipe();
    return out;
  }

  /** Overwrites the key-dependent mid-states with zeros. */
  wipe(): void {
    this.innerState.fill(0);
    this.outerState.fill(0);
  }

  /** HMAC-SHA-256 of `data` under `key` in one call. */
  static tag(key: Uint8Array, data: Uint8Array): Uint8Array<ArrayBuffer> {
    const mac = new HmacSha256(key);
    const out = mac.tag(data);
    mac.wipe();
    return out;
  }
}

/** The state after one block `keyBlock XOR pad`. */
function absorbPaddedKey(keyBlock: Uint8Array, pad: number, schedule: Int32Array): Int32Array {
  for (let i = 0, p = 0; i < 16; i++, p += 4) {
    schedule[i] =
      ((keyBlock[p] ^ pad) << 24) |
      ((keyBlock[p + 1] ^ pad) << 16) |
      ((keyBlock[p + 2] ^ pad) << 8) |
      (keyBlock[p + 3] ^ pad);
  }
  const state = initialState();
  compress(state, schedule);
  return state;
}
