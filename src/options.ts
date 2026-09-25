// Rendering options and the contrast measure: sections 6 and 9 of the specification.

import { figuresX100, over, ratioX100 } from "./contrast.js";
import { HhError, HhErrorCode } from "./errors.js";
import { FRAME_COLOUR } from "./features.js";
import { FRAME_STYLES, SHAPES, isFrameStyle, isIntegerIn, isShape } from "./model.js";
import type { FrameStyle, Shape } from "./model.js";

/**
 * The look of a render. The cells, the palette and the geometry are fixed by the specification. Every
 * property is optional; the defaults give a square picture on an opaque white background. A property
 * with any other name is refused with `invalid_argument`, so that a misspelt option does not silently
 * leave the default in place.
 */
export interface RenderOptions {
  /** Square (the default) or round. */
  readonly shape?: Shape | undefined;
  /**
   * The frame style; the default is `automatic`. Every style works in either mode if it fits the shape:
   * `none`, `plain`, `double` and `thick` fit both, `rounded`, `chamfered` and `brackets` the square, `ticks`
   * and `gaps` the round shape. A style that does not fit the shape is `invalid_frame`.
   */
  readonly frame?: FrameStyle | undefined;
  /** The background colour as `0xRRGGBB`; the default is `0xFFFFFF`. */
  readonly backgroundRgb?: number | undefined;
  /**
   * 0 (transparent) to 255 (opaque, the default). Outside rounded or chamfered corners and outside the
   * disc the picture is always transparent.
   */
  readonly backgroundAlpha?: number | undefined;
  /** 0 to 255 (the default); the frame colour itself is fixed. */
  readonly frameAlpha?: number | undefined;
}

/** WCAG contrast ratios times 100 (300 means 3:1), rounded down. */
export interface ContrastReport {
  /** The weakest palette colour against the background. */
  readonly figuresX100: number;
  /** The frame against the background. */
  readonly frameX100: number;
}

/** {@link RenderOptions} with every default filled in. */
export interface ResolvedOptions {
  /** The shape. */
  readonly shape: Shape;
  /** The frame style, possibly `automatic`. */
  readonly frame: FrameStyle;
  /** The background colour as `0xRRGGBB`. */
  readonly backgroundRgb: number;
  /** The background alpha, 0..255. */
  readonly backgroundAlpha: number;
  /** The frame alpha, 0..255. */
  readonly frameAlpha: number;
}

/** Throws `invalid_argument` unless `rgb` is an integer in `0..0xFFFFFF`. */
export function checkColour(rgb: unknown): asserts rgb is number {
  if (!isIntegerIn(rgb, 0, 0xffffff)) {
    throw new HhError(HhErrorCode.INVALID_ARGUMENT, "a colour is an integer 0..0xFFFFFF");
  }
}

/** True if `name` is a property of {@link RenderOptions}. */
function isOptionName(name: string): name is keyof RenderOptions {
  switch (name) {
    case "shape":
    case "frame":
    case "backgroundRgb":
    case "backgroundAlpha":
    case "frameAlpha":
      return true;
    default:
      return false;
  }
}

/**
 * Validates `options` and fills in the defaults. The names looked at are the own enumerable string keys
 * of the object.
 *
 * @throws {@link HhError} with `invalid_argument` for a property that is not one of {@link RenderOptions},
 * an unknown shape or frame style, a colour outside `0..0xFFFFFF` or an alpha outside `0..255`.
 */
export function resolveOptions(options: RenderOptions | undefined): ResolvedOptions {
  if (options === undefined) {
    options = {};
  }
  if (typeof options !== "object" || options === null) {
    throw new HhError(HhErrorCode.INVALID_ARGUMENT, "the options are not an object");
  }
  for (const name of Object.keys(options)) {
    if (!isOptionName(name)) {
      throw new HhError(HhErrorCode.INVALID_ARGUMENT, `there is no option ${name}`);
    }
  }
  const {
    shape = "square",
    frame = "automatic",
    backgroundRgb = 0xffffff,
    backgroundAlpha = 255,
    frameAlpha = 255,
  } = options;
  if (!isShape(shape)) {
    throw new HhError(HhErrorCode.INVALID_ARGUMENT, `the shape is one of ${SHAPES.join(", ")}`);
  }
  if (!isFrameStyle(frame)) {
    throw new HhError(HhErrorCode.INVALID_ARGUMENT, `the frame is one of ${FRAME_STYLES.join(", ")}`);
  }
  checkColour(backgroundRgb);
  if (!isIntegerIn(backgroundAlpha, 0, 255) || !isIntegerIn(frameAlpha, 0, 255)) {
    throw new HhError(HhErrorCode.INVALID_ARGUMENT, "an alpha is an integer 0..255");
  }
  return { shape, frame, backgroundRgb, backgroundAlpha, frameAlpha };
}

/**
 * Measures what `options` give over a page of the colour `pageRgb` (`0xRRGGBB`); for an opaque background
 * the page does not matter. Rendering refuses an opaque background with
 * {@link ContrastReport.figuresX100} below 200; hosts should warn below 300.
 *
 * @throws {@link HhError} with `invalid_argument` if an option is unknown or out of range, or if `pageRgb`
 * is out of range.
 */
export function measureContrast(options: RenderOptions = {}, pageRgb = 0xffffff): ContrastReport {
  const resolved = resolveOptions(options);
  checkColour(pageRgb);
  const seen = over(resolved.backgroundRgb, resolved.backgroundAlpha, pageRgb);
  const frame = over(FRAME_COLOUR, resolved.frameAlpha, seen);
  return { figuresX100: figuresX100(seen), frameX100: ratioX100(frame, seen) };
}
