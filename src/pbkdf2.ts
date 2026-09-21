import { HmacSha256 } from "./hmac.js";
import { BLOCK_SIZE, DIGEST_SIZE, compress, storeState } from "./sha256.js";

/** The bit length of the padded key block followed by one 32-byte digest, the message of every `U_j`. */
const CHAINED_BITS = (BLOCK_SIZE + DIGEST_SIZE) * 8;

/**
 * Starts the HMAC step of one `U_j`: copies the mid-state `from` into `state` and loads the single block
 * that follows the padded key when the message is one digest, the 8 words of `digest`, the `0x80`
 * terminator, zeros and the bit length (FIPS 180-4 section 5.1.1). Plain loops: this runs 32 768 times
 * per base digest, and a call of `TypedArray.prototype.set` costs more than copying eight words.
 */
function loadChained(state: Int32Array, from: Int32Array, w: Int32Array, digest: Int32Array): void {
  for (let k = 0; k < 8; k++) {
    w[k] = digest[k];
    state[k] = from[k];
  }
  w[8] = 0x80000000 | 0;
  for (let k = 9; k < 15; k++) {
    w[k] = 0;
  }
  w[15] = CHAINED_BITS;
}

/**
 * PBKDF2 with HMAC-SHA-256 as the PRF, as specified in RFC 8018 section 5.2. Internal to the library.
 *
 * Every iteration after the first costs exactly two SHA-256 compressions: the HMAC key is absorbed once
 * into the inner and the outer mid-state, and each `U_j` is the HMAC of a 32-byte message, one padded
 * block for the inner hash and one for the outer hash. The chain stays in 32-bit words throughout.
 *
 * `iterations` is at least 1 and `length` is not negative.
 */
export function pbkdf2HmacSha256(
  password: Uint8Array,
  salt: Uint8Array,
  iterations: number,
  length: number,
): Uint8Array<ArrayBuffer> {
  const prf = new HmacSha256(password);
  const out = new Uint8Array(length);
  const inner = new Int32Array(8);
  const u = new Int32Array(8);
  const t = new Int32Array(8);
  const w = new Int32Array(64);
  const block = new Uint8Array(DIGEST_SIZE);
  const counter = new Uint8Array(4);
  for (let index = 1, offset = 0; offset < length; index++, offset += DIGEST_SIZE) {
    // U_1 = PRF(P, S || INT(i)).
    counter[0] = index >>> 24;
    counter[1] = index >>> 16;
    counter[2] = index >>> 8;
    counter[3] = index;
    const first = prf.tag(salt, counter);
    for (let k = 0; k < 8; k++) {
      const p = 4 * k;
      u[k] = (first[p] << 24) | (first[p + 1] << 16) | (first[p + 2] << 8) | first[p + 3];
    }
    first.fill(0);
    t.set(u);

    // U_j = PRF(P, U_{j-1}); T = U_1 ^ U_2 ^ ... ^ U_c.
    for (let j = 1; j < iterations; j++) {
      loadChained(inner, prf.innerState, w, u);
      compress(inner, w);
      loadChained(u, prf.outerState, w, inner);
      compress(u, w);
      for (let k = 0; k < 8; k++) {
        t[k] ^= u[k];
      }
    }

    storeState(t, block, 0);
    out.set(block.subarray(0, Math.min(DIGEST_SIZE, length - offset)), offset);
  }
  prf.wipe();
  inner.fill(0);
  u.fill(0);
  t.fill(0);
  w.fill(0);
  block.fill(0);
  return out;
}
