// Feature extraction: section 5 of the specification.

import type { Cell, Figure } from "./model.js";

/** The palette of section 5.2 as `0xRRGGBB`. */
export const PALETTE: readonly number[] = [0x7a96c5, 0x890af0, 0xc10445, 0xd48200];

/** The frame colour of section 5.2. */
export const FRAME_COLOUR = 0x808080;

/** The figure of each figure code `floor(b / 32)`. */
const FIGURE_OF_CODE: readonly Figure[] = [
  "none",
  "none",
  "square",
  "circle",
  "triangle-up",
  "triangle-right",
  "triangle-down",
  "triangle-left",
];

/** Crockford Base32. */
const TAG_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/** The 16 cells of a fingerprint, row-major from the top left (section 5.1). */
export function cellsOf(fp: Uint8Array): Cell[] {
  const cells: Cell[] = [];
  for (let i = 0; i < 16; i++) {
    const b = fp[i];
    const figure = FIGURE_OF_CODE[b >>> 5];
    cells.push({ figure, colour: figure === "none" ? 0 : (b >>> 3) & 3 });
  }
  return cells;
}

/** The 6-character tag of a fingerprint (section 5.3). */
export function tagOf(fp: Uint8Array): string {
  // The top 30 bits of the big-endian word fp[16..19]; `>>>` keeps the word unsigned.
  const v = ((fp[16] << 24) | (fp[17] << 16) | (fp[18] << 8) | fp[19]) >>> 2;
  let tag = "";
  for (let shift = 25; shift >= 0; shift -= 5) {
    tag += TAG_ALPHABET[(v >>> shift) & 31];
  }
  return tag;
}
