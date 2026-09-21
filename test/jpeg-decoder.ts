// A small baseline JPEG decoder (ITU-T T.81, sequential DCT, Huffman, 8 bits, no subsampling, no restart
// intervals), written for the tests: Node.js has no JPEG decoder, and the encoder deserves an independent
// reader. It follows the decoding procedures of T.81 annex F.2 and uses a floating-point inverse DCT,
// which is fine in a test.

export interface DecodedJpeg {
  readonly width: number;
  readonly height: number;
  /** 3 bytes per pixel, R, G, B. */
  readonly rgb: Uint8Array;
  /** The quantiser tables by identifier, in natural order. */
  readonly quantisers: ReadonlyMap<number, readonly number[]>;
}

interface Component {
  readonly id: number;
  readonly quantiser: number;
  dcTable: number;
  acTable: number;
  previousDc: number;
}

/** T.81 annex F.2.2.3: the smallest and the largest code of each length and the index of its first symbol. */
class HuffmanTable {
  private readonly minCode: number[] = [];
  private readonly maxCode: number[] = [];
  private readonly firstIndex: number[] = [];
  private readonly symbols: readonly number[];

  constructor(counts: readonly number[], symbols: readonly number[]) {
    this.symbols = symbols;
    let code = 0;
    let index = 0;
    for (let length = 1; length <= 16; length++) {
      const count = counts[length - 1] as number;
      this.minCode[length] = code;
      this.firstIndex[length] = index;
      this.maxCode[length] = count === 0 ? -1 : code + count - 1;
      code = (code + count) << 1;
      index += count;
    }
  }

  decode(bits: BitReader): number {
    let code = 0;
    for (let length = 1; length <= 16; length++) {
      code = (code << 1) | bits.bit();
      if (code <= (this.maxCode[length] as number)) {
        const symbol = this.symbols[(this.firstIndex[length] as number) + code - (this.minCode[length] as number)];
        if (symbol === undefined) {
          throw new Error("JPEG: a code without a symbol");
        }
        return symbol;
      }
    }
    throw new Error("JPEG: no Huffman code of up to 16 bits matches");
  }
}

class BitReader {
  private readonly data: Uint8Array;
  private at: number;
  private current = 0;
  private left = 0;

  constructor(data: Uint8Array, at: number) {
    this.data = data;
    this.at = at;
  }

  get position(): number {
    return this.at;
  }

  bit(): number {
    if (this.left === 0) {
      const byte = this.data[this.at++];
      if (byte === undefined) {
        throw new Error("JPEG: the entropy-coded data ends early");
      }
      if (byte === 0xff) {
        // T.81 section B.1.1.5: FF in the data is followed by a stuffed 00.
        if (this.data[this.at++] !== 0x00) {
          throw new Error("JPEG: a marker inside the entropy-coded data");
        }
      }
      this.current = byte;
      this.left = 8;
    }
    this.left--;
    return (this.current >> this.left) & 1;
  }

  /** T.81 F.2.2.1 (EXTEND): `count` additional bits as a signed value. */
  value(count: number): number {
    let v = 0;
    for (let i = 0; i < count; i++) {
      v = (v << 1) | this.bit();
    }
    return count !== 0 && v < 1 << (count - 1) ? v - (1 << count) + 1 : v;
  }

  /** The bits that pad the last byte; the encoder must have set them to 1. */
  padding(): number[] {
    const bits: number[] = [];
    while (this.left !== 0) {
      bits.push(this.bit());
    }
    return bits;
  }
}

const ZIGZAG = [
  0, 1, 8, 16, 9, 2, 3, 10, 17, 24, 32, 25, 18, 11, 4, 5, 12, 19, 26, 33, 40, 48, 41, 34, 27, 20, 13, 6, 7,
  14, 21, 28, 35, 42, 49, 56, 57, 50, 43, 36, 29, 22, 15, 23, 30, 37, 44, 51, 58, 59, 52, 45, 38, 31, 39,
  46, 53, 60, 61, 54, 47, 55, 62, 63,
];

/** `cos((2 x + 1) u pi / 16)`, with the factor `1 / sqrt(2)` of `u = 0` folded in. */
const BASIS = Array.from({ length: 8 }, (_, x) =>
  Array.from({ length: 8 }, (_, u) => (u === 0 ? Math.SQRT1_2 : 1) * Math.cos(((2 * x + 1) * u * Math.PI) / 16)),
);

/** T.81 A.3.3: the inverse DCT, by its definition. */
function inverseDct(coefficients: readonly number[]): number[] {
  const out = new Array<number>(64).fill(0);
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      let sum = 0;
      for (let v = 0; v < 8; v++) {
        for (let u = 0; u < 8; u++) {
          const basis = ((BASIS[x] as number[])[u] as number) * ((BASIS[y] as number[])[v] as number);
          sum += (coefficients[8 * v + u] as number) * basis;
        }
      }
      out[8 * y + x] = sum / 4;
    }
  }
  return out;
}

const clamp = (v: number): number => Math.min(255, Math.max(0, Math.round(v)));

export function decodeJpeg(file: Uint8Array): DecodedJpeg {
  const u16 = (at: number): number => ((file[at] as number) << 8) | (file[at + 1] as number);
  if (u16(0) !== 0xffd8) {
    throw new Error("JPEG: no SOI marker");
  }
  const quantisers = new Map<number, number[]>();
  const huffman = new Map<number, HuffmanTable>();
  const components: Component[] = [];
  let width = 0;
  let height = 0;
  let at = 2;
  for (;;) {
    const marker = u16(at);
    const length = u16(at + 2);
    const body = at + 4;
    at += 2 + length;
    if (marker === 0xffe0) {
      if (Buffer.from(file.subarray(body, body + 5)).toString("latin1") !== "JFIF\0") {
        throw new Error("JPEG: APP0 is not JFIF");
      }
    } else if (marker === 0xffdb) {
      for (let p = body; p < at; p += 65) {
        const id = file[p] as number;
        if (id >> 4 !== 0) {
          throw new Error("JPEG: a 16-bit quantiser table");
        }
        const table = new Array<number>(64).fill(0);
        for (let i = 0; i < 64; i++) {
          table[ZIGZAG[i] as number] = file[p + 1 + i] as number;
        }
        quantisers.set(id, table);
      }
    } else if (marker === 0xffc0) {
      if (file[body] !== 8) {
        throw new Error("JPEG: not 8 bits per sample");
      }
      height = u16(body + 1);
      width = u16(body + 3);
      for (let c = 0; c < (file[body + 5] as number); c++) {
        const p = body + 6 + 3 * c;
        if (file[p + 1] !== 0x11) {
          throw new Error("JPEG: a subsampled component");
        }
        const [id, , quantiser] = file.subarray(p, p + 3);
        components.push({ id: id as number, quantiser: quantiser as number, dcTable: 0, acTable: 0, previousDc: 0 });
      }
    } else if (marker === 0xffc4) {
      for (let p = body; p < at; ) {
        const id = file[p] as number;
        const counts = [...file.subarray(p + 1, p + 17)];
        const total = counts.reduce((a, b) => a + b, 0);
        huffman.set(id, new HuffmanTable(counts, [...file.subarray(p + 17, p + 17 + total)]));
        p += 17 + total;
      }
    } else if (marker === 0xffda) {
      const count = file[body] as number;
      for (let c = 0; c < count; c++) {
        const component = components.find((k) => k.id === file[body + 1 + 2 * c]);
        if (component === undefined) {
          throw new Error("JPEG: the scan names an unknown component");
        }
        const tables = file[body + 2 + 2 * c] as number;
        component.dcTable = tables >> 4;
        component.acTable = 0x10 | (tables & 0x0f);
      }
      break;
    } else {
      throw new Error(`JPEG: unexpected marker ${marker.toString(16)}`);
    }
  }
  if (components.length !== 3 || width === 0 || height === 0) {
    throw new Error("JPEG: not a three-component image");
  }

  const bits = new BitReader(file, at);
  const blocksAcross = Math.ceil(width / 8);
  const blocksDown = Math.ceil(height / 8);
  const planes = components.map(() => new Float64Array(blocksAcross * 8 * blocksDown * 8));
  for (let by = 0; by < blocksDown; by++) {
    for (let bx = 0; bx < blocksAcross; bx++) {
      components.forEach((component, c) => {
        const dc = huffman.get(component.dcTable);
        const ac = huffman.get(component.acTable);
        const q = quantisers.get(component.quantiser);
        if (dc === undefined || ac === undefined || q === undefined) {
          throw new Error("JPEG: a table is missing");
        }
        const coefficients = new Array<number>(64).fill(0);
        component.previousDc += bits.value(dc.decode(bits));
        coefficients[0] = component.previousDc * (q[0] as number);
        for (let k = 1; k < 64; k++) {
          const symbol = ac.decode(bits);
          if (symbol === 0x00) {
            break;
          }
          k += symbol >> 4;
          if (symbol === 0xf0) {
            continue;
          }
          if (k > 63) {
            throw new Error("JPEG: a run beyond the block");
          }
          const natural = ZIGZAG[k] as number;
          coefficients[natural] = bits.value(symbol & 0x0f) * (q[natural] as number);
        }
        const samples = inverseDct(coefficients);
        const plane = planes[c] as Float64Array;
        for (let j = 0; j < 8; j++) {
          for (let i = 0; i < 8; i++) {
            plane[(8 * by + j) * blocksAcross * 8 + 8 * bx + i] = (samples[8 * j + i] as number) + 128;
          }
        }
      });
    }
  }
  if (bits.padding().some((bit) => bit !== 1)) {
    throw new Error("JPEG: the last byte is not filled with 1 bits");
  }
  if (u16(bits.position) !== 0xffd9 || bits.position + 2 !== file.length) {
    throw new Error("JPEG: no EOI marker at the end of the data");
  }

  // JFIF 1.02: YCbCr to RGB.
  const rgb = new Uint8Array(width * height * 3);
  const [Y, Cb, Cr] = planes as [Float64Array, Float64Array, Float64Array];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const p = y * blocksAcross * 8 + x;
      const luma = Y[p] as number;
      const cb = (Cb[p] as number) - 128;
      const cr = (Cr[p] as number) - 128;
      const pixel = [luma + 1.402 * cr, luma - 0.344136 * cb - 0.714136 * cr, luma + 1.772 * cb];
      rgb.set(pixel.map(clamp), 3 * (y * width + x));
    }
  }
  return { width, height, rgb, quantisers };
}
