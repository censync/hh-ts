// The encoders checked with independent decoders: zlib of Node.js for PNG, a plain reader for BMP and
// the test-only baseline decoder of jpeg-decoder.ts for JPEG.

import assert from "node:assert/strict";
import { test } from "node:test";
import { inflateSync } from "node:zlib";

import { flatten } from "../src/bmp.js";
import { adler32, crc32 } from "../src/checksums.js";
import { Fingerprint, HhImage } from "../src/index.js";
import type { Mode, RenderOptions } from "../src/index.js";
import * as jpeg from "../src/jpeg.js";
import { decodeJpeg } from "./jpeg-decoder.js";
import { Lcg, ascii, pattern, repeatByte } from "./util.js";

function sample(size: number, mode: Mode, options: RenderOptions = {}): HhImage {
  const bytes = Uint8Array.from({ length: 32 }, (_, i) => (i * 37 + 11) & 0xff);
  return Fingerprint.fromBytes(bytes, mode).render(size, options);
}

interface Pixels {
  readonly width: number;
  readonly height: number;
  /** R, G, B, A. */
  readonly rgba: Uint8Array;
}

/** Reads a PNG of colour type 2 or 6 without interlace whose rows all use filter 0, and checks every CRC. */
function decodePng(file: Uint8Array): Pixels & { readonly chunks: readonly string[]; readonly zlib: Uint8Array } {
  const view = new DataView(file.buffer, file.byteOffset, file.byteLength);
  assert.deepEqual([...file.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const chunks: string[] = [];
  const data = new Map<string, Uint8Array>();
  for (let at = 8; at < file.length; ) {
    const length = view.getUint32(at);
    const type = Buffer.from(file.subarray(at + 4, at + 8)).toString("latin1");
    assert.equal(view.getUint32(at + 8 + length), crc32(file.subarray(at + 4, at + 8 + length)), `CRC of ${type}`);
    chunks.push(type);
    data.set(type, file.subarray(at + 8, at + 8 + length));
    at += 12 + length;
  }
  const ihdr = data.get("IHDR") as Uint8Array;
  const header = new DataView(ihdr.buffer, ihdr.byteOffset, ihdr.byteLength);
  const width = header.getUint32(0);
  const height = header.getUint32(4);
  const [depth, colourType, ...methods] = ihdr.subarray(8);
  assert.deepEqual([depth, ...methods], [8, 0, 0, 0], "bit depth, compression, filter, interlace");
  assert.ok(colourType === 2 || colourType === 6);
  const bpp = colourType === 2 ? 3 : 4;
  const zlib = data.get("IDAT") as Uint8Array;
  const raw = inflateSync(zlib);
  assert.equal(raw.length, (1 + width * bpp) * height);
  const rgba = new Uint8Array(width * height * 4).fill(0xff);
  for (let y = 0; y < height; y++) {
    const row = y * (1 + width * bpp);
    assert.equal(raw[row], 0, "filter type");
    for (let x = 0; x < width; x++) {
      for (let c = 0; c < bpp; c++) {
        rgba[(y * width + x) * 4 + c] = raw[row + 1 + x * bpp + c] as number;
      }
    }
  }
  return { width, height, rgba, chunks, zlib };
}

/** Reads a bottom-up 24-bit BI_RGB BMP. */
function decodeBmp(file: Uint8Array): Pixels {
  const view = new DataView(file.buffer, file.byteOffset, file.byteLength);
  assert.equal(Buffer.from(file.subarray(0, 2)).toString("latin1"), "BM");
  assert.equal(view.getUint32(2, true), file.length, "file size");
  assert.equal(view.getUint32(10, true), 54, "pixel data offset");
  assert.equal(view.getUint32(14, true), 40, "header size");
  const width = view.getInt32(18, true);
  const height = view.getInt32(22, true);
  assert.deepEqual([view.getUint16(26, true), view.getUint16(28, true), view.getUint32(30, true)], [1, 24, 0]);
  const row = Math.ceil((3 * width) / 4) * 4;
  assert.equal(view.getUint32(34, true), row * height, "image size");
  assert.equal(file.length, 54 + row * height);
  const rgba = new Uint8Array(width * height * 4).fill(0xff);
  for (let y = 0; y < height; y++) {
    const at = 54 + (height - 1 - y) * row;
    for (let x = 0; x < width; x++) {
      const [b, g, r] = file.subarray(at + 3 * x, at + 3 * x + 3);
      rgba.set([r as number, g as number, b as number], (y * width + x) * 4);
    }
    assert.ok(file.subarray(at + 3 * width, at + row).every((b) => b === 0), "row padding");
  }
  return { width, height, rgba };
}

function flattened(image: HhImage, matte: number): Uint8Array {
  const out = new Uint8Array(image.rgba.length).fill(0xff);
  for (let p = 0; p < out.length; p += 4) {
    const a = image.rgba[p + 3] as number;
    for (let c = 0; c < 3; c++) {
      out[p + c] = flatten(image.rgba[p + c] as number, a, (matte >> (16 - 8 * c)) & 0xff);
    }
  }
  return out;
}

test("checksums have their check values", () => {
  assert.equal(crc32(ascii("123456789")), 0xcbf43926);
  assert.equal(crc32(ascii("1234"), ascii("56789")), 0xcbf43926);
  assert.equal(crc32(), 0);
  assert.equal(adler32(ascii("Wikipedia")), 0x11e60398);
  assert.equal(adler32(repeatByte(0xff, 20000)), 0x9f51d664);
  assert.equal(adler32(new Uint8Array(0)), 1);
});

test("PNG decodes to the same pixels", () => {
  const round: RenderOptions = {
    shape: "round",
    frame: "gaps",
    backgroundRgb: 0x121212,
    backgroundAlpha: 200,
    frameAlpha: 100,
  };
  for (const image of [sample(16, "universal"), sample(33, "keyed"), sample(128, "keyed", round)]) {
    const decoded = decodePng(image.encodePng());
    assert.deepEqual([decoded.width, decoded.height], [image.width, image.height]);
    assert.deepEqual(decoded.rgba, image.rgba);
    assert.deepEqual(decoded.chunks, ["IHDR", "sRGB", "IDAT", "IEND"]);
  }
});

test("PNG has alpha only if some pixel is not opaque", () => {
  assert.equal(sample(32, "universal").encodePng()[25], 2);
  assert.equal(sample(32, "keyed").encodePng()[25], 6); // transparent corners
  assert.equal(sample(32, "universal", { backgroundAlpha: 254 }).encodePng()[25], 6);
});

test("the zlib stream is one final block with fixed Huffman codes", () => {
  const { zlib } = decodePng(sample(48, "keyed").encodePng());
  assert.deepEqual([...zlib.subarray(0, 2)], [0x78, 0x01]);
  assert.equal((zlib[2] as number) & 0x07, 0b011); // BFINAL = 1, BTYPE = 01, least significant bit first
});

test("PNG of arbitrary pixels decodes", () => {
  const random = new Lcg(11);
  for (const [width, height] of [[1, 1], [3, 5], [64, 9], [300, 3], [2, 300]] as const) {
    for (const kind of ["noise", "opaque"]) {
      const image = HhImage.ofRgba(width, height, pattern(`${kind}:${random.nextInt(1000)}`, width, height));
      assert.deepEqual(decodePng(image.encodePng()).rgba, image.rgba, `${kind} ${width} x ${height}`);
    }
  }
});

test("PNG of long runs and repeated rows decodes", () => {
  // Matches of the maximum length 258, matches that overlap their source and both distances.
  for (const [width, height] of [[1000, 4], [259, 3], [86, 7], [87, 7], [4096, 2]] as const) {
    const rgba = new Uint8Array(width * height * 4);
    for (let i = 0; i < rgba.length; i++) {
      rgba[i] = i % 4 === 3 ? 0xff : ((i >> 2) % 7 === 0 ? 0x10 : 0x20) + (((i >> 2) / width) | 0) % 2;
    }
    const image = HhImage.ofRgba(width, height, rgba);
    assert.deepEqual(decodePng(image.encodePng()).rgba, rgba, `${width} x ${height}`);
  }
});

test("BMP decodes to the flattened pixels", () => {
  for (const image of [sample(33, "keyed"), sample(34, "keyed"), sample(35, "universal"), sample(36, "keyed")]) {
    for (const matte of [0xffffff, 0x0048ff]) {
      const decoded = decodeBmp(image.encodeBmp(matte));
      assert.deepEqual([decoded.width, decoded.height], [image.width, image.height]);
      assert.deepEqual(decoded.rgba, flattened(image, matte));
    }
  }
});

test("JPEG decodes close to the pixels", () => {
  const image = sample(100, "universal"); // not a multiple of 8
  const expected = flattened(image, 0xffffff);
  for (const [quality, meanLimit, worstLimit] of [[100, 0.35, 6], [92, 1.5, 70], [50, 4.0, 140]] as const) {
    const decoded = decodeJpeg(image.encodeJpeg(quality));
    assert.deepEqual([decoded.width, decoded.height], [100, 100]);
    let total = 0;
    let worst = 0;
    for (let p = 0; p < 100 * 100; p++) {
      for (let c = 0; c < 3; c++) {
        const d = Math.abs((expected[4 * p + c] as number) - (decoded.rgb[3 * p + c] as number));
        total += d;
        worst = Math.max(worst, d);
      }
    }
    const mean = total / (100 * 100 * 3);
    assert.ok(mean < meanLimit, `quality ${quality}: mean error ${mean}`);
    assert.ok(worst <= worstLimit, `quality ${quality}: worst error ${worst}`);
  }
});

test("JPEG flattens transparency over the matte", () => {
  const image = HhImage.ofRgba(16, 16, new Uint8Array(16 * 16 * 4)); // fully transparent
  const decoded = decodeJpeg(image.encodeJpeg(100, 0x3366cc));
  for (let p = 0; p < 16 * 16; p++) {
    for (const [c, value] of [0x33, 0x66, 0xcc].entries()) {
      assert.ok(Math.abs((decoded.rgb[3 * p + c] as number) - value) <= 2, `pixel ${p}`);
    }
  }
});

test("JPEG of noise and of odd sizes decodes", () => {
  const random = new Lcg(5);
  for (const [width, height] of [[1, 1], [7, 9], [8, 8], [17, 24], [64, 1]] as const) {
    const image = HhImage.ofRgba(width, height, random.nextBytes(width * height * 4));
    for (const quality of [50, 77, 100]) {
      const decoded = decodeJpeg(image.encodeJpeg(quality, 0x808080));
      assert.deepEqual([decoded.width, decoded.height], [width, height], `${width} x ${height} at ${quality}`);
    }
  }
});

test("JPEG quantiser tables follow the quality", () => {
  const image = sample(16, "universal");
  const scaled = (base: readonly number[], quality: number): number[] =>
    base.map((b) => Math.min(255, Math.max(1, Math.floor((b * (200 - 2 * quality) + 50) / 100))));
  for (const quality of [50, 51, 75, 92, 99, 100]) {
    const { quantisers } = decodeJpeg(image.encodeJpeg(quality));
    assert.deepEqual(quantisers.get(0), scaled(jpeg.LUMINANCE_QUANTISER, quality), `luminance at ${quality}`);
    assert.deepEqual(quantisers.get(1), scaled(jpeg.CHROMINANCE_QUANTISER, quality), `chrominance at ${quality}`);
  }
  assert.ok((decodeJpeg(image.encodeJpeg(100)).quantisers.get(0) as number[]).every((q) => q === 1));
});

test("the JPEG tables are well-formed", () => {
  assert.deepEqual([...jpeg.ZIGZAG].sort((a, b) => a - b), Array.from({ length: 64 }, (_, i) => i));
  // Zigzag: the sum of row and column never decreases, and changes by at most one.
  for (let i = 1; i < 64; i++) {
    const [a, b] = [jpeg.ZIGZAG[i - 1] as number, jpeg.ZIGZAG[i] as number];
    const step = ((b >> 3) + (b & 7)) - ((a >> 3) + (a & 7));
    assert.ok(step === 0 || step === 1, `zigzag ${i}`);
  }
  const tables = { DC_LUMINANCE: 12, DC_CHROMINANCE: 12, AC_LUMINANCE: 162, AC_CHROMINANCE: 162 } as const;
  for (const [name, symbols] of Object.entries(tables)) {
    const spec = jpeg[name as keyof typeof tables];
    assert.equal(spec.counts.length, 16, name);
    assert.equal(spec.symbols.length, symbols, name);
    assert.equal(spec.counts.reduce((a, b) => a + b, 0), symbols, name);
    assert.equal(new Set(spec.symbols).size, symbols, `${name}: a symbol twice`);
    // Kraft: the codes fit a prefix code, with room for the all-ones code that T.81 reserves.
    const kraft = spec.counts.reduce((sum, count, i) => sum + count * 2 ** (15 - i), 0);
    assert.ok(kraft < 2 ** 16, name);
  }
  // Every AC symbol is a run and a category of 1..10, or one of the two special symbols.
  for (const spec of [jpeg.AC_LUMINANCE, jpeg.AC_CHROMINANCE]) {
    const expected = [0x00, 0xf0];
    for (let run = 0; run < 16; run++) {
      for (let category = 1; category <= 10; category++) {
        expected.push(run * 16 + category);
      }
    }
    assert.deepEqual([...spec.symbols].sort((a, b) => a - b), expected.sort((a, b) => a - b));
  }
});
