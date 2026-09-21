// BMP: section 12 of the specification.

import { ByteSink } from "./bytes.js";

/**
 * One channel with the alpha `a` flattened over a matte channel: section 10 of the specification. The
 * numerator is at most 255 * 255 + 127 (see `floorDiv` for the division).
 */
export function flatten(value: number, a: number, matte: number): number {
  return ((a * value + (255 - a) * matte + 127) / 255) | 0;
}

/** Encodes `width * height` RGBA pixels, flattened over `matteRgb`, as the BMP file of section 12. */
export function encodeBmp(
  width: number,
  height: number,
  rgba: Uint8Array,
  matteRgb: number,
): Uint8Array<ArrayBuffer> {
  const row = ((3 * width + 3) >> 2) << 2;
  const dataSize = row * height;
  const header = new ByteSink(54);
  header.putAscii("BM");
  header.putLe32(54 + dataSize);
  header.putLe16(0);
  header.putLe16(0);
  header.putLe32(54);
  header.putLe32(40);
  header.putLe32(width);
  header.putLe32(height);
  header.putLe16(1);
  header.putLe16(24);
  header.putLe32(0);
  header.putLe32(dataSize);
  header.putLe32(2835);
  header.putLe32(2835);
  header.putLe32(0);
  header.putLe32(0);

  const out = new Uint8Array(54 + dataSize);
  out.set(header.view());
  const mr = (matteRgb >>> 16) & 0xff;
  const mg = (matteRgb >>> 8) & 0xff;
  const mb = matteRgb & 0xff;
  for (let y = height - 1, at = 54; y >= 0; y--, at += row) {
    // The 0..3 bytes that pad a row to a multiple of 4 stay zero.
    for (let x = 0, p = y * width * 4, q = at; x < width; x++, p += 4, q += 3) {
      const a = rgba[p + 3];
      out[q] = flatten(rgba[p + 2], a, mb);
      out[q + 1] = flatten(rgba[p + 1], a, mg);
      out[q + 2] = flatten(rgba[p], a, mr);
    }
  }
  return out;
}
