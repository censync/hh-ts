// PNG: section 11 of the specification. Deflate is RFC 1951, zlib RFC 1950.

import { ByteSink } from "./bytes.js";
import { adler32, crc32 } from "./checksums.js";

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** RFC 1951 section 3.2.5: the base length and the extra bits of the length codes 257..285. */
const LENGTH_BASE = [
  3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195,
  227, 258,
];
const LENGTH_EXTRA = [
  0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0,
];

/** RFC 1951 section 3.2.5: the base distance and the extra bits of the distance codes 0..29. */
const DIST_BASE = [
  1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073,
  4097, 6145, 8193, 12289, 16385, 24577,
];
const DIST_EXTRA = [
  0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13,
];

/** Deflate packs bits from the least significant bit of each byte. At most 13 bits go in at a time. */
class BitWriter {
  private readonly out: ByteSink;
  private acc = 0;
  private used = 0;

  constructor(out: ByteSink) {
    this.out = out;
  }

  /** Appends the low `count` bits of `bits`, least significant bit first. */
  put(bits: number, count: number): void {
    this.acc |= bits << this.used;
    this.used += count;
    while (this.used >= 8) {
      this.out.put(this.acc);
      this.acc >>>= 8;
      this.used -= 8;
    }
  }

  /** Appends a Huffman code, which is sent most significant bit first. */
  putCode(code: number, count: number): void {
    let reversed = 0;
    for (let i = 0; i < count; i++) {
      reversed = (reversed << 1) | ((code >>> i) & 1);
    }
    this.put(reversed, count);
  }

  /** Pads the last byte with zero bits. */
  flush(): void {
    if (this.used !== 0) {
      this.out.put(this.acc);
      this.acc = 0;
      this.used = 0;
    }
  }
}

/** The fixed literal/length code of RFC 1951 section 3.2.6. */
function putSymbol(w: BitWriter, symbol: number): void {
  if (symbol < 144) {
    w.putCode(0x30 + symbol, 8);
  } else if (symbol < 256) {
    w.putCode(0x190 + (symbol - 144), 9);
  } else if (symbol < 280) {
    w.putCode(symbol - 256, 7);
  } else {
    w.putCode(0xc0 + (symbol - 280), 8);
  }
}

function putMatch(w: BitWriter, length: number, dist: number): void {
  let li = 28;
  while (LENGTH_BASE[li] > length) {
    li--;
  }
  putSymbol(w, 257 + li);
  w.put(length - LENGTH_BASE[li], LENGTH_EXTRA[li]);
  let di = 29;
  while (DIST_BASE[di] > dist) {
    di--;
  }
  w.putCode(di, 5);
  w.put(dist - DIST_BASE[di], DIST_EXTRA[di]);
}

/** The length of the match of `raw` at `i` with `raw` at `i - dist`, at most `limit`. */
function matchLength(raw: Uint8Array, i: number, dist: number, limit: number): number {
  let length = 0;
  while (length < limit && raw[i + length] === raw[i - dist + length]) {
    length++;
  }
  return length;
}

/** One deflate block with fixed Huffman codes and greedy matches at the distances `bpp` and `stride`. */
function deflateFixed(raw: Uint8Array, bpp: number, stride: number, out: ByteSink): void {
  const w = new BitWriter(out);
  w.put(1, 1); // BFINAL
  w.put(1, 2); // BTYPE = 01
  const n = raw.length;
  let i = 0;
  while (i < n) {
    const limit = Math.min(258, n - i);
    let best = 0;
    let dist = 0;
    if (i >= bpp) {
      best = matchLength(raw, i, bpp, limit);
      dist = bpp;
    }
    if (i >= stride) {
      const above = matchLength(raw, i, stride, limit);
      if (above > best) {
        best = above;
        dist = stride;
      }
    }
    if (best >= 3) {
      putMatch(w, best, dist);
      i += best;
    } else {
      putSymbol(w, raw[i]);
      i++;
    }
  }
  putSymbol(w, 256);
  w.flush();
}

function putChunk(out: ByteSink, type: string, data: Uint8Array): void {
  const name = new Uint8Array(4);
  for (let i = 0; i < 4; i++) {
    name[i] = type.charCodeAt(i);
  }
  out.putBe32(data.length);
  out.putAll(name);
  out.putAll(data);
  out.putBe32(crc32(name, data));
}

/** Encodes `width * height` RGBA pixels as the PNG file of section 11. */
export function encodePng(width: number, height: number, rgba: Uint8Array): Uint8Array<ArrayBuffer> {
  let opaque = true;
  for (let p = 3, end = 4 * width * height; p < end && opaque; p += 4) {
    opaque = rgba[p] === 0xff;
  }
  const bpp = opaque ? 3 : 4;
  const stride = 1 + width * bpp;
  const raw = new Uint8Array(stride * height);
  for (let y = 0, src = 0; y < height; y++) {
    let at = y * stride + 1; // the filter byte stays 0
    for (let x = 0; x < width; x++, src += 4) {
      raw[at++] = rgba[src];
      raw[at++] = rgba[src + 1];
      raw[at++] = rgba[src + 2];
      if (!opaque) {
        raw[at++] = rgba[src + 3];
      }
    }
  }

  const zlib = new ByteSink((raw.length >>> 3) + 64);
  zlib.put(0x78);
  zlib.put(0x01);
  deflateFixed(raw, bpp, stride, zlib);
  zlib.putBe32(adler32(raw));

  const ihdr = new ByteSink(13);
  ihdr.putBe32(width);
  ihdr.putBe32(height);
  ihdr.putAll([8, opaque ? 2 : 6, 0, 0, 0]);

  const png = new ByteSink(zlib.size + 64);
  png.putAll(SIGNATURE);
  putChunk(png, "IHDR", ihdr.view());
  putChunk(png, "sRGB", new Uint8Array(1));
  putChunk(png, "IDAT", zlib.view());
  putChunk(png, "IEND", new Uint8Array(0));
  return png.toBytes();
}
