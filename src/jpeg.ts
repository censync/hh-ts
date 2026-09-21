// JPEG: section 13 and appendix B of the specification; ITU-T T.81 and JFIF 1.02.

import { flatten } from "./bmp.js";
import { ByteSink } from "./bytes.js";

/** `zigzag[i]` is the natural (row-major) index of the i-th coefficient. */
export const ZIGZAG: readonly number[] = [
  0, 1, 8, 16, 9, 2, 3, 10, 17, 24, 32, 25, 18, 11, 4, 5, 12, 19, 26, 33, 40, 48, 41, 34, 27, 20, 13, 6, 7,
  14, 21, 28, 35, 42, 49, 56, 57, 50, 43, 36, 29, 22, 15, 23, 30, 37, 44, 51, 58, 59, 52, 45, 38, 31, 39,
  46, 53, 60, 61, 54, 47, 55, 62, 63,
];

/** T.81 table K.1 in natural order. */
export const LUMINANCE_QUANTISER: readonly number[] = [
  16, 11, 10, 16, 24, 40, 51, 61, 12, 12, 14, 19, 26, 58, 60, 55, 14, 13, 16, 24, 40, 57, 69, 56, 14, 17,
  22, 29, 51, 87, 80, 62, 18, 22, 37, 56, 68, 109, 103, 77, 24, 35, 55, 64, 81, 104, 113, 92, 49, 64, 78,
  87, 103, 121, 120, 101, 72, 92, 95, 98, 112, 100, 103, 99,
];

/** T.81 table K.2 in natural order. */
export const CHROMINANCE_QUANTISER: readonly number[] = [
  17, 18, 24, 47, 99, 99, 99, 99, 18, 21, 26, 66, 99, 99, 99, 99, 24, 26, 56, 99, 99, 99, 99, 99, 47, 66,
  99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99,
  99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99,
];

/** A Huffman table: the number of codes of each length 1..16, and the symbols in code order. */
export interface HuffmanSpec {
  /** The number of codes of each length 1..16. */
  readonly counts: readonly number[];
  /** The symbols in code order. */
  readonly symbols: readonly number[];
}

const DC_SYMBOLS: readonly number[] = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];

/** T.81 table K.3. */
export const DC_LUMINANCE: HuffmanSpec = {
  counts: [0, 1, 5, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0],
  symbols: DC_SYMBOLS,
};

/** T.81 table K.4. */
export const DC_CHROMINANCE: HuffmanSpec = {
  counts: [0, 3, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0],
  symbols: DC_SYMBOLS,
};

/** T.81 table K.5. */
export const AC_LUMINANCE: HuffmanSpec = {
  counts: [0, 2, 1, 3, 3, 2, 4, 3, 5, 5, 4, 4, 0, 0, 1, 0x7d],
  symbols: [
    0x01, 0x02, 0x03, 0x00, 0x04, 0x11, 0x05, 0x12, 0x21, 0x31, 0x41, 0x06, 0x13, 0x51, 0x61, 0x07, 0x22,
    0x71, 0x14, 0x32, 0x81, 0x91, 0xa1, 0x08, 0x23, 0x42, 0xb1, 0xc1, 0x15, 0x52, 0xd1, 0xf0, 0x24, 0x33,
    0x62, 0x72, 0x82, 0x09, 0x0a, 0x16, 0x17, 0x18, 0x19, 0x1a, 0x25, 0x26, 0x27, 0x28, 0x29, 0x2a, 0x34,
    0x35, 0x36, 0x37, 0x38, 0x39, 0x3a, 0x43, 0x44, 0x45, 0x46, 0x47, 0x48, 0x49, 0x4a, 0x53, 0x54, 0x55,
    0x56, 0x57, 0x58, 0x59, 0x5a, 0x63, 0x64, 0x65, 0x66, 0x67, 0x68, 0x69, 0x6a, 0x73, 0x74, 0x75, 0x76,
    0x77, 0x78, 0x79, 0x7a, 0x83, 0x84, 0x85, 0x86, 0x87, 0x88, 0x89, 0x8a, 0x92, 0x93, 0x94, 0x95, 0x96,
    0x97, 0x98, 0x99, 0x9a, 0xa2, 0xa3, 0xa4, 0xa5, 0xa6, 0xa7, 0xa8, 0xa9, 0xaa, 0xb2, 0xb3, 0xb4, 0xb5,
    0xb6, 0xb7, 0xb8, 0xb9, 0xba, 0xc2, 0xc3, 0xc4, 0xc5, 0xc6, 0xc7, 0xc8, 0xc9, 0xca, 0xd2, 0xd3, 0xd4,
    0xd5, 0xd6, 0xd7, 0xd8, 0xd9, 0xda, 0xe1, 0xe2, 0xe3, 0xe4, 0xe5, 0xe6, 0xe7, 0xe8, 0xe9, 0xea, 0xf1,
    0xf2, 0xf3, 0xf4, 0xf5, 0xf6, 0xf7, 0xf8, 0xf9, 0xfa,
  ],
};

/** T.81 table K.6. */
export const AC_CHROMINANCE: HuffmanSpec = {
  counts: [0, 2, 1, 2, 4, 4, 3, 4, 7, 5, 4, 4, 0, 1, 2, 0x77],
  symbols: [
    0x00, 0x01, 0x02, 0x03, 0x11, 0x04, 0x05, 0x21, 0x31, 0x06, 0x12, 0x41, 0x51, 0x07, 0x61, 0x71, 0x13,
    0x22, 0x32, 0x81, 0x08, 0x14, 0x42, 0x91, 0xa1, 0xb1, 0xc1, 0x09, 0x23, 0x33, 0x52, 0xf0, 0x15, 0x62,
    0x72, 0xd1, 0x0a, 0x16, 0x24, 0x34, 0xe1, 0x25, 0xf1, 0x17, 0x18, 0x19, 0x1a, 0x26, 0x27, 0x28, 0x29,
    0x2a, 0x35, 0x36, 0x37, 0x38, 0x39, 0x3a, 0x43, 0x44, 0x45, 0x46, 0x47, 0x48, 0x49, 0x4a, 0x53, 0x54,
    0x55, 0x56, 0x57, 0x58, 0x59, 0x5a, 0x63, 0x64, 0x65, 0x66, 0x67, 0x68, 0x69, 0x6a, 0x73, 0x74, 0x75,
    0x76, 0x77, 0x78, 0x79, 0x7a, 0x82, 0x83, 0x84, 0x85, 0x86, 0x87, 0x88, 0x89, 0x8a, 0x92, 0x93, 0x94,
    0x95, 0x96, 0x97, 0x98, 0x99, 0x9a, 0xa2, 0xa3, 0xa4, 0xa5, 0xa6, 0xa7, 0xa8, 0xa9, 0xaa, 0xb2, 0xb3,
    0xb4, 0xb5, 0xb6, 0xb7, 0xb8, 0xb9, 0xba, 0xc2, 0xc3, 0xc4, 0xc5, 0xc6, 0xc7, 0xc8, 0xc9, 0xca, 0xd2,
    0xd3, 0xd4, 0xd5, 0xd6, 0xd7, 0xd8, 0xd9, 0xda, 0xe2, 0xe3, 0xe4, 0xe5, 0xe6, 0xe7, 0xe8, 0xe9, 0xea,
    0xf2, 0xf3, 0xf4, 0xf5, 0xf6, 0xf7, 0xf8, 0xf9, 0xfa,
  ],
};

// The fixed-point constants of section 13.5: cosine products times 2^13.
const F0298 = 2446;
const F0390 = 3196;
const F0541 = 4433;
const F0765 = 6270;
const F0899 = 7373;
const F1175 = 9633;
const F1501 = 12299;
const F1847 = 15137;
const F1961 = 16069;
const F2053 = 16819;
const F2562 = 20995;
const F3072 = 25172;

/** Section 13.2: the base table scaled for `quality`. */
function scaleQuantiser(base: readonly number[], quality: number): Int32Array {
  const scale = 200 - 2 * quality;
  // At most 121 * 100 + 50, and the divisor is 100 (see `floorDiv` for the division).
  return Int32Array.from(base, (b) => Math.min(Math.max(((b * scale + 50) / 100) | 0, 1), 255));
}

function putHuffmanTable(out: ByteSink, id: number, spec: HuffmanSpec): void {
  out.put(0xff);
  out.put(0xc4);
  out.putBe16(2 + 1 + 16 + spec.symbols.length);
  out.put(id);
  out.putAll(spec.counts);
  out.putAll(spec.symbols);
}

/**
 * One pass of the forward transform of section 13.5 over the eight values of `d` spaced `step` apart from
 * `base`. The specification guarantees that every intermediate value fits a signed 32-bit integer, so
 * `Math.imul` multiplies exactly, and `>>` on a signed 32-bit integer is the floor division of `DESCALE`.
 */
function dctPass(d: Int32Array, base: number, step: number, first: boolean): void {
  const i0 = base;
  const i1 = base + step;
  const i2 = base + 2 * step;
  const i3 = base + 3 * step;
  const i4 = base + 4 * step;
  const i5 = base + 5 * step;
  const i6 = base + 6 * step;
  const i7 = base + 7 * step;
  const t0 = d[i0] + d[i7];
  const t7 = d[i0] - d[i7];
  const t1 = d[i1] + d[i6];
  const t6 = d[i1] - d[i6];
  const t2 = d[i2] + d[i5];
  const t5 = d[i2] - d[i5];
  const t3 = d[i3] + d[i4];
  const t4 = d[i3] - d[i4];
  const t10 = t0 + t3;
  const t13 = t0 - t3;
  const t11 = t1 + t2;
  const t12 = t1 - t2;
  const n = first ? 11 : 15;
  const half = 1 << (n - 1);
  if (first) {
    d[i0] = (t10 + t11) << 2;
    d[i4] = (t10 - t11) << 2;
  } else {
    d[i0] = (t10 + t11 + 2) >> 2;
    d[i4] = (t10 - t11 + 2) >> 2;
  }
  const z = Math.imul(t12 + t13, F0541);
  d[i2] = (z + Math.imul(t13, F0765) + half) >> n;
  d[i6] = (z - Math.imul(t12, F1847) + half) >> n;

  const z5 = Math.imul(t4 + t6 + t5 + t7, F1175);
  const z1 = -Math.imul(t4 + t7, F0899);
  const z2 = -Math.imul(t5 + t6, F2562);
  const z3 = -Math.imul(t4 + t6, F1961) + z5;
  const z4 = -Math.imul(t5 + t7, F0390) + z5;
  d[i7] = (Math.imul(t4, F0298) + z1 + z3 + half) >> n;
  d[i5] = (Math.imul(t5, F2053) + z2 + z4 + half) >> n;
  d[i3] = (Math.imul(t6, F3072) + z2 + z3 + half) >> n;
  d[i1] = (Math.imul(t7, F1501) + z1 + z4 + half) >> n;
}

/** Section 13.5: the rows, then the columns. The result is the DCT scaled by 8. */
function forwardDct(block: Int32Array): void {
  for (let row = 0; row < 8; row++) {
    dctPass(block, 8 * row, 1, true);
  }
  for (let column = 0; column < 8; column++) {
    dctPass(block, column, 8, false);
  }
}

/** The code and the code length of every symbol: the canonical assignment of T.81 annex C. */
class HuffmanEncoder {
  readonly code = new Int32Array(256);
  readonly length = new Int32Array(256);

  constructor(spec: HuffmanSpec) {
    let next = 0;
    let k = 0;
    for (let bits = 1; bits <= 16; bits++) {
      for (let i = 0; i < spec.counts[bits - 1]; i++) {
        const symbol = spec.symbols[k++];
        this.code[symbol] = next++;
        this.length[symbol] = bits;
      }
      next <<= 1;
    }
  }
}

/** The DC and the AC encoders, luminance then chrominance. */
const DC_ENCODERS = [new HuffmanEncoder(DC_LUMINANCE), new HuffmanEncoder(DC_CHROMINANCE)];
const AC_ENCODERS = [new HuffmanEncoder(AC_LUMINANCE), new HuffmanEncoder(AC_CHROMINANCE)];

/** Entropy-coded data: most significant bit first, `FF` followed by `00`. At most 16 bits go in at a time. */
class ScanWriter {
  private readonly out: ByteSink;
  private acc = 0;
  private used = 0;

  constructor(out: ByteSink) {
    this.out = out;
  }

  /** Appends the low `count` bits of `bits`. */
  put(bits: number, count: number): void {
    this.acc = (this.acc << count) | (bits & ((1 << count) - 1));
    this.used += count;
    while (this.used >= 8) {
      this.used -= 8;
      const b = (this.acc >>> this.used) & 0xff;
      this.out.put(b);
      if (b === 0xff) {
        this.out.put(0x00);
      }
    }
    this.acc &= (1 << this.used) - 1;
  }

  /** Fills the last byte with 1 bits. */
  finish(): void {
    if (this.used !== 0) {
      this.put(0xff, 8 - this.used);
    }
  }
}

/** The number of bits of `abs(v)`. */
function category(v: number): number {
  let a = Math.abs(v);
  let n = 0;
  while (a !== 0) {
    n++;
    a >>>= 1;
  }
  return n;
}

/** The additional bits of `v`: its low `bits` bits if it is not negative, otherwise those of `v - 1`. */
function putValue(w: ScanWriter, v: number, bits: number): void {
  if (bits !== 0) {
    w.put(v >= 0 ? v : v - 1, bits);
  }
}

/** Codes one block in zigzag order and returns its DC value, the predictor of the next block. */
function encodeBlock(
  w: ScanWriter,
  zz: Int32Array,
  previousDc: number,
  dc: HuffmanEncoder,
  ac: HuffmanEncoder,
): number {
  const diff = zz[0] - previousDc;
  const dcBits = category(diff);
  w.put(dc.code[dcBits], dc.length[dcBits]);
  putValue(w, diff, dcBits);
  let run = 0;
  for (let k = 1; k < 64; k++) {
    const v = zz[k];
    if (v === 0) {
      run++;
      continue;
    }
    for (; run >= 16; run -= 16) {
      w.put(ac.code[0xf0], ac.length[0xf0]);
    }
    const bits = category(v);
    const symbol = run * 16 + bits;
    w.put(ac.code[symbol], ac.length[symbol]);
    putValue(w, v, bits);
    run = 0;
  }
  if (run !== 0) {
    w.put(ac.code[0x00], ac.length[0x00]);
  }
  return zz[0];
}

/** Encodes `width * height` RGBA pixels, flattened over `matteRgb`, as the JPEG file of section 13. */
export function encodeJpeg(
  width: number,
  height: number,
  rgba: Uint8Array,
  quality: number,
  matteRgb: number,
): Uint8Array<ArrayBuffer> {
  const quantisers = [
    scaleQuantiser(LUMINANCE_QUANTISER, quality),
    scaleQuantiser(CHROMINANCE_QUANTISER, quality),
  ];
  const out = new ByteSink(((width * height) >>> 1) + 1024);
  out.putAll([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
  out.putAscii("JFIF");
  out.putAll([0x00, 0x01, 0x02, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00]);
  for (let id = 0; id < 2; id++) {
    out.putAll([0xff, 0xdb, 0x00, 0x43, id]);
    for (let i = 0; i < 64; i++) {
      out.put(quantisers[id][ZIGZAG[i]]);
    }
  }
  out.putAll([0xff, 0xc0, 0x00, 0x11, 0x08]);
  out.putBe16(height);
  out.putBe16(width);
  out.putAll([3, 1, 0x11, 0, 2, 0x11, 1, 3, 0x11, 1]);
  putHuffmanTable(out, 0x00, DC_LUMINANCE);
  putHuffmanTable(out, 0x10, AC_LUMINANCE);
  putHuffmanTable(out, 0x01, DC_CHROMINANCE);
  putHuffmanTable(out, 0x11, AC_CHROMINANCE);
  out.putAll([0xff, 0xda, 0x00, 0x0c, 3, 1, 0x00, 2, 0x11, 3, 0x11, 0, 63, 0]);

  const writer = new ScanWriter(out);
  const previousDc = [0, 0, 0];
  const blocks = [new Int32Array(64), new Int32Array(64), new Int32Array(64)];
  const zz = new Int32Array(64);
  const mr = (matteRgb >>> 16) & 0xff;
  const mg = (matteRgb >>> 8) & 0xff;
  const mb = matteRgb & 0xff;
  for (let by = 0; by < height; by += 8) {
    for (let bx = 0; bx < width; bx += 8) {
      // Sections 13.3 and 13.4: a block beyond the image repeats the last column and the last row. All
      // three numerators are non-negative and below 2^31, so `>> 16` is the floor division by 65536.
      for (let j = 0; j < 8; j++) {
        const y = Math.min(by + j, height - 1);
        for (let i = 0; i < 8; i++) {
          const x = Math.min(bx + i, width - 1);
          const p = (y * width + x) * 4;
          const a = rgba[p + 3];
          const r = flatten(rgba[p], a, mr);
          const g = flatten(rgba[p + 1], a, mg);
          const b = flatten(rgba[p + 2], a, mb);
          const k = 8 * j + i;
          blocks[0][k] = ((19595 * r + 38470 * g + 7471 * b + 32768) >> 16) - 128;
          blocks[1][k] = ((-11059 * r - 21709 * g + 32768 * b + 8421375) >> 16) - 128;
          blocks[2][k] = ((32768 * r - 27439 * g - 5329 * b + 8421375) >> 16) - 128;
        }
      }
      for (let c = 0; c < 3; c++) {
        const table = c === 0 ? 0 : 1;
        const block = blocks[c];
        const q = quantisers[table];
        forwardDct(block);
        // Section 13.6. The magnitude of a coefficient is below 2^15 and the divisor at most 8 * 255
        // (see `floorDiv` for the division).
        for (let i = 0; i < 64; i++) {
          const k = ZIGZAG[i];
          const coefficient = block[k];
          const divisor = 8 * q[k];
          const half = divisor >> 1;
          let value =
            coefficient >= 0
              ? ((coefficient + half) / divisor) | 0
              : -(((-coefficient + half) / divisor) | 0);
          // The baseline AC tables stop at 10 bits. DC values stay within -1024..1016 by construction,
          // so their differences fit 11 bits.
          if (i !== 0) {
            value = Math.min(Math.max(value, -1023), 1023);
          }
          zz[i] = value;
        }
        previousDc[c] = encodeBlock(writer, zz, previousDc[c], DC_ENCODERS[table], AC_ENCODERS[table]);
      }
    }
  }
  writer.finish();
  out.put(0xff);
  out.put(0xd9);
  return out.toBytes();
}
