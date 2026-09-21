// WCAG contrast in integer arithmetic: section 9 of the specification. Colours are `0xRRGGBB`.

import { PALETTE } from "./features.js";
import { floorDiv } from "./int.js";

/** `LIN` of appendix A: the sRGB transfer function times 10^6. */
const LIN: readonly number[] = [
  0, 304, 607, 911, 1214, 1518, 1821, 2125, 2428, 2732, 3035, 3347,
  3677, 4025, 4391, 4777, 5182, 5605, 6049, 6512, 6995, 7499, 8023, 8568,
  9134, 9721, 10330, 10960, 11612, 12286, 12983, 13702, 14444, 15209, 15996, 16807,
  17642, 18500, 19382, 20289, 21219, 22174, 23153, 24158, 25187, 26241, 27321, 28426,
  29557, 30713, 31896, 33105, 34340, 35601, 36889, 38204, 39546, 40915, 42311, 43735,
  45186, 46665, 48172, 49707, 51269, 52861, 54480, 56128, 57805, 59511, 61246, 63010,
  64803, 66626, 68478, 70360, 72272, 74214, 76185, 78187, 80220, 82283, 84376, 86500,
  88656, 90842, 93059, 95307, 97587, 99899, 102242, 104616, 107023, 109462, 111932, 114435,
  116971, 119538, 122139, 124772, 127438, 130136, 132868, 135633, 138432, 141263, 144128, 147027,
  149960, 152926, 155926, 158961, 162029, 165132, 168269, 171441, 174647, 177888, 181164, 184475,
  187821, 191202, 194618, 198069, 201556, 205079, 208637, 212231, 215861, 219526, 223228, 226966,
  230740, 234551, 238398, 242281, 246201, 250158, 254152, 258183, 262251, 266356, 270498, 274677,
  278894, 283149, 287441, 291771, 296138, 300544, 304987, 309469, 313989, 318547, 323143, 327778,
  332452, 337164, 341914, 346704, 351533, 356400, 361307, 366253, 371238, 376262, 381326, 386429,
  391572, 396755, 401978, 407240, 412543, 417885, 423268, 428690, 434154, 439657, 445201, 450786,
  456411, 462077, 467784, 473531, 479320, 485150, 491021, 496933, 502886, 508881, 514918, 520996,
  527115, 533276, 539479, 545724, 552011, 558340, 564712, 571125, 577580, 584078, 590619, 597202,
  603827, 610496, 617207, 623960, 630757, 637597, 644480, 651406, 658375, 665387, 672443, 679542,
  686685, 693872, 701102, 708376, 715694, 723055, 730461, 737910, 745404, 752942, 760525, 768151,
  775822, 783538, 791298, 799103, 806952, 814847, 822786, 830770, 838799, 846873, 854993, 863157,
  871367, 879622, 887923, 896269, 904661, 913099, 921582, 930111, 938686, 947307, 955973, 964686,
  973445, 982251, 991102, 1000000,
];

/**
 * The relative luminance times 10^10. The weights sum to 10^4 and `LIN` is at most 10^6, so the value is
 * at most 10^10: beyond 32 bits, which is why the specification asks for 64-bit integers, and far below
 * 2^53, so every product and the sum are exact.
 */
export function luminance(rgb: number): number {
  return 2126 * LIN[(rgb >>> 16) & 0xff] + 7152 * LIN[(rgb >>> 8) & 0xff] + 722 * LIN[rgb & 0xff];
}

/**
 * The contrast ratio of two colours times 100, rounded down. The numerator is at most
 * `100 * (10^10 + 5 * 10^8)`, about 2^40, so the multiplication is exact and `floorDiv` applies.
 */
export function ratioX100(a: number, b: number): number {
  const ya = luminance(a);
  const yb = luminance(b);
  const hi = Math.max(ya, yb) + 500000000;
  const lo = Math.min(ya, yb) + 500000000;
  return floorDiv(100 * hi, lo);
}

/** `OVER`: the colour `rgb` with the alpha `alpha` laid over the colour `under`. */
export function over(rgb: number, alpha: number, under: number): number {
  let out = 0;
  for (let shift = 16; shift >= 0; shift -= 8) {
    const top = (rgb >>> shift) & 0xff;
    const bottom = (under >>> shift) & 0xff;
    // At most 255 * 255 + 127, so the quotient fits 8 bits (see `floorDiv` for the division).
    out |= (((alpha * top + (255 - alpha) * bottom + 127) / 255) | 0) << shift;
  }
  return out;
}

/** The weakest palette colour against `background`. */
export function figuresX100(background: number): number {
  let weakest = ratioX100(PALETTE[0], background);
  for (let i = 1; i < PALETTE.length; i++) {
    weakest = Math.min(weakest, ratioX100(PALETTE[i], background));
  }
  return weakest;
}
