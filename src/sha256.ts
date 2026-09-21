// SHA-256 as specified in FIPS 180-4. Internal to the library; the public API never exposes it.
//
// Words are kept as signed 32-bit integers in `Int32Array`s: `|`, `^`, `&`, `<<`, `>>>` and `| 0` are
// 32-bit operations in JavaScript, and an addition of a few words stays far below 2^53 before `| 0`
// reduces it modulo 2^32.

/** The size of a message block in bytes. */
export const BLOCK_SIZE = 64;

/** The size of a digest in bytes. */
export const DIGEST_SIZE = 32;

/** FIPS 180-4 section 4.2.2: the first 32 bits of the fractional parts of the cube roots of the primes. */
const K = new Int32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

/** FIPS 180-4 section 5.3.3: the initial hash value H(0). */
const H0 = new Int32Array([
  0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
]);

/** A fresh copy of the initial hash value H(0). */
export function initialState(): Int32Array {
  return H0.slice();
}

/**
 * The compression function of FIPS 180-4 section 6.2.2. `w` has 64 words; the caller loads the message
 * block into `w[0..15]` and this function expands the rest of the schedule. `state` has 8 words and is
 * updated in place.
 */
export function compress(state: Int32Array, w: Int32Array): void {
  for (let t = 16; t < 64; t++) {
    const x = w[t - 15];
    const y = w[t - 2];
    const s0 = ((x >>> 7) | (x << 25)) ^ ((x >>> 18) | (x << 14)) ^ (x >>> 3);
    const s1 = ((y >>> 17) | (y << 15)) ^ ((y >>> 19) | (y << 13)) ^ (y >>> 10);
    w[t] = (s1 + w[t - 7] + s0 + w[t - 16]) | 0;
  }
  let a = state[0];
  let b = state[1];
  let c = state[2];
  let d = state[3];
  let e = state[4];
  let f = state[5];
  let g = state[6];
  let h = state[7];
  for (let t = 0; t < 64; t++) {
    const big1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
    const big0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
    const t1 = (h + big1 + ((e & f) ^ (~e & g)) + K[t] + w[t]) | 0;
    const t2 = (big0 + ((a & b) ^ (a & c) ^ (b & c))) | 0;
    h = g;
    g = f;
    f = e;
    e = (d + t1) | 0;
    d = c;
    c = b;
    b = a;
    a = (t1 + t2) | 0;
  }
  state[0] = (state[0] + a) | 0;
  state[1] = (state[1] + b) | 0;
  state[2] = (state[2] + c) | 0;
  state[3] = (state[3] + d) | 0;
  state[4] = (state[4] + e) | 0;
  state[5] = (state[5] + f) | 0;
  state[6] = (state[6] + g) | 0;
  state[7] = (state[7] + h) | 0;
}

/** Loads the 64-byte block at `offset` into `w[0..15]` as big-endian words. */
function loadBlock(w: Int32Array, block: Uint8Array, offset: number): void {
  for (let i = 0, p = offset; i < 16; i++, p += 4) {
    w[i] = (block[p] << 24) | (block[p + 1] << 16) | (block[p + 2] << 8) | block[p + 3];
  }
}

/** Writes the 8 words of `state` into `out` at `offset` as big-endian bytes. */
export function storeState(state: Int32Array, out: Uint8Array, offset: number): void {
  for (let i = 0, p = offset; i < 8; i++, p += 4) {
    const word = state[i];
    out[p] = word >>> 24;
    out[p + 1] = word >>> 16;
    out[p + 2] = word >>> 8;
    out[p + 3] = word;
  }
}

/**
 * An incremental SHA-256 hasher. After {@link Sha256.finish} it must not be used again. The total input
 * must stay below 2^53 bytes, which no JavaScript program can exceed.
 */
export class Sha256 {
  private readonly state: Int32Array;
  private readonly buffer = new Uint8Array(BLOCK_SIZE);
  private readonly schedule = new Int32Array(64);
  private length: number;
  private buffered = 0;

  /**
   * Creates a hasher in the state H(0), or resumes from `state` after `absorbed` bytes, a multiple of the
   * block size. HMAC resumes from the mid-state that has absorbed the padded key.
   */
  constructor(state: Int32Array = H0, absorbed = 0) {
    this.state = state.slice();
    this.length = absorbed;
  }

  /** Absorbs `data`. */
  update(data: Uint8Array): this {
    let pos = 0;
    let remaining = data.length;
    this.length += remaining;
    if (this.buffered !== 0) {
      const take = Math.min(remaining, BLOCK_SIZE - this.buffered);
      this.buffer.set(data.subarray(0, take), this.buffered);
      this.buffered += take;
      pos += take;
      remaining -= take;
      if (this.buffered < BLOCK_SIZE) {
        return this;
      }
      loadBlock(this.schedule, this.buffer, 0);
      compress(this.state, this.schedule);
      this.buffered = 0;
    }
    while (remaining >= BLOCK_SIZE) {
      loadBlock(this.schedule, data, pos);
      compress(this.state, this.schedule);
      pos += BLOCK_SIZE;
      remaining -= BLOCK_SIZE;
    }
    if (remaining !== 0) {
      this.buffer.set(data.subarray(pos, pos + remaining), 0);
      this.buffered = remaining;
    }
    return this;
  }

  /** Completes the hash and returns the 32-byte digest. */
  finish(): Uint8Array<ArrayBuffer> {
    // FIPS 180-4 section 5.1.1: a one bit, zeros, and the bit length as a 64-bit big-endian integer.
    const buffer = this.buffer;
    buffer[this.buffered++] = 0x80;
    if (this.buffered > BLOCK_SIZE - 8) {
      buffer.fill(0, this.buffered);
      loadBlock(this.schedule, buffer, 0);
      compress(this.state, this.schedule);
      this.buffered = 0;
    }
    buffer.fill(0, this.buffered);
    loadBlock(this.schedule, buffer, 0);
    // The bit length is 8 * length. Its high word is length / 2^29, a division by a power of two, which
    // only changes the exponent of a double and is exact before `| 0` drops the fraction. `<<` reduces its
    // operand modulo 2^32 first, which gives the low word.
    this.schedule[14] = (this.length / 0x20000000) | 0;
    this.schedule[15] = this.length << 3;
    compress(this.state, this.schedule);
    const out = new Uint8Array(DIGEST_SIZE);
    storeState(this.state, out, 0);
    return out;
  }

  /** Overwrites the state, the buffered input and the message schedule with zeros. */
  wipe(): void {
    this.state.fill(0);
    this.buffer.fill(0);
    this.schedule.fill(0);
    this.length = 0;
    this.buffered = 0;
  }

  /** The digest of `data` in one call. */
  static digest(data: Uint8Array): Uint8Array<ArrayBuffer> {
    const hasher = new Sha256();
    const out = hasher.update(data).finish();
    hasher.wipe();
    return out;
  }
}
