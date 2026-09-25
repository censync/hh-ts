// The vocabulary of the public API: modes, shapes, frame styles, figures and the layout of a picture.

/** The two modes, in the order of their numbers in the specification (universal = 1, keyed = 2). */
export const MODES = Object.freeze(["universal", "keyed"] as const);

/**
 * A universal picture is the same for everyone and is what two parties compare. A keyed picture can be
 * computed only with the secret key and is the default inside an application. The two pictures of one
 * input are unrelated.
 */
export type Mode = (typeof MODES)[number];

/** The outlines of a picture. */
export const SHAPES = Object.freeze(["square", "round"] as const);

/**
 * The outline of a picture: `square` is the default; `round` inscribes the 4 x 4 grid in a circle, so
 * that no cell is clipped and the cells are smaller.
 */
export type Shape = (typeof SHAPES)[number];

/**
 * The frame styles, spelled as in section 6 of the specification. Every style is available in both modes;
 * {@link FrameStyle} says which shape each one fits.
 */
export const FRAME_STYLES = Object.freeze([
  "automatic",
  "none",
  "plain",
  "rounded",
  "chamfered",
  "double",
  "thick",
  "brackets",
  "ticks",
  "gaps",
] as const);

/**
 * The frame of a picture. Every style is available to universal and keyed fingerprints alike; `rounded`,
 * `chamfered` and `brackets` need the square shape, `ticks` and `gaps` the round one, and rendering refuses
 * a style that does not fit the shape with `invalid_frame`. A host that marks its keyed pictures with a
 * frame picks the style; `automatic` gives keyed square pictures rounded corners.
 *
 * - `automatic`: `rounded` for a keyed fingerprint with the square shape, otherwise `none`
 * - `none`: no frame
 * - `plain`: a thin square frame, or a thin ring
 * - `rounded`: square only, rounded corners
 * - `chamfered`: square only, four cut corners
 * - `double`: two thin lines
 * - `thick`: one line three times as thick
 * - `brackets`: square only, corner brackets
 * - `ticks`: round only, a ring with four ticks
 * - `gaps`: round only, a ring with four gaps
 */
export type FrameStyle = (typeof FRAME_STYLES)[number];

/** The figures; the index of a figure in this array is its layout value in the specification. */
export const FIGURES = Object.freeze([
  "none",
  "square",
  "circle",
  "triangle-up",
  "triangle-right",
  "triangle-down",
  "triangle-left",
] as const);

/**
 * What a cell shows: nothing, the full cell, the disc inscribed in the cell, or an isosceles triangle
 * whose base is one full side of the cell and whose apex is the middle of the opposite side.
 * `triangle-up` has its base on the bottom side.
 */
export type Figure = (typeof FIGURES)[number];

/** One cell of the 4 x 4 matrix. */
export interface Cell {
  /** What the cell shows. */
  readonly figure: Figure;
  /** The index of the colour in {@link Layout.paletteRgb}, 0..3; 0 for an empty cell. */
  readonly colour: number;
}

/**
 * What a fingerprint shows, for hosts that draw vectors themselves. The raster of
 * `Fingerprint.render` is the canonical form and the only one covered by byte-exact vectors.
 */
export interface Layout {
  /** The mode of the fingerprint. */
  readonly mode: Mode;
  /** The 16 cells, row-major from the top left. */
  readonly cells: readonly Cell[];
  /** The four colours of the figures as `0xRRGGBB`. */
  readonly paletteRgb: readonly number[];
  /** The colour of the frame as `0xRRGGBB`. */
  readonly frameRgb: number;
}

/** True if `value` is a {@link Mode}. The exported arrays are for callers; validation does not read them. */
export function isMode(value: unknown): value is Mode {
  return value === "universal" || value === "keyed";
}

/** True if `value` is a {@link Shape}. */
export function isShape(value: unknown): value is Shape {
  return value === "square" || value === "round";
}

/** True if `value` is a {@link FrameStyle}. */
export function isFrameStyle(value: unknown): value is FrameStyle {
  switch (value) {
    case "automatic":
    case "none":
    case "plain":
    case "rounded":
    case "chamfered":
    case "double":
    case "thick":
    case "brackets":
    case "ticks":
    case "gaps":
      return true;
    default:
      return false;
  }
}

/** True if `value` is an integer in `lo..hi`. */
export function isIntegerIn(value: unknown, lo: number, hi: number): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= lo && value <= hi;
}

// The accessors of %TypedArray%.prototype. They read the internal slots of a typed array, so neither a
// `Symbol.toStringTag` property nor a `length` getter of a subclass has a say, and they work on the typed
// arrays of every realm.
const TYPED_ARRAY: object = Object.getPrototypeOf(Uint8Array.prototype);
const typedArrayName = Object.getOwnPropertyDescriptor(TYPED_ARRAY, Symbol.toStringTag)?.get;
const typedArrayLength = Object.getOwnPropertyDescriptor(TYPED_ARRAY, "length")?.get;

/**
 * True if `value` is a `Uint8Array` (or a subclass such as the `Buffer` of Node.js), also when it comes
 * from another realm, where `instanceof` fails. An object that only claims to be one is not, and neither
 * is a `Proxy` of one.
 */
export function isBytes(value: unknown): value is Uint8Array {
  return typedArrayName?.call(value) === "Uint8Array";
}

/** The number of bytes of `bytes`, whatever its `length` property says; 0 once its buffer is detached. */
export function byteCount(bytes: Uint8Array): number {
  return typedArrayLength?.call(bytes) as number;
}

/**
 * The library's own copy of `value` if it is a `Uint8Array` of `size` bytes, otherwise `undefined`. The
 * length that counts is that of the copy.
 */
export function copyOfSize(value: unknown, size: number): Uint8Array<ArrayBuffer> | undefined {
  if (!isBytes(value) || byteCount(value) !== size) {
    return undefined;
  }
  const copy = new Uint8Array(value);
  if (copy.length !== size) {
    copy.fill(0);
    return undefined;
  }
  return copy;
}

/** True if `a` and `b` hold the same bytes. Not constant-time: for public values only. */
export function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) {
    return false;
  }
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) {
      return false;
    }
  }
  return true;
}
