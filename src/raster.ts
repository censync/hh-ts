// Geometry and rasterisation: sections 6, 7 and 8 of the specification.
//
// Every quantity is an integer below 2^31: sample coordinates reach 8 * 1024, their squares and the sums
// of two squares 2 * 8192^2 < 2^28, and the compositing products 16 * 255^3 < 2^29.

import { figuresX100 } from "./contrast.js";
import { HhError, HhErrorCode } from "./errors.js";
import { FRAME_COLOUR, PALETTE, cellsOf } from "./features.js";
import { isIntegerIn } from "./model.js";
import type { Figure, FrameStyle, Mode, Shape } from "./model.js";
import { resolveOptions } from "./options.js";
import type { RenderOptions } from "./options.js";

/** The smallest size of a render in pixels. */
export const MIN_SIZE = 16;

/** The largest size of a render in pixels. */
export const MAX_SIZE = 1024;

/** The geometry of section 7. All values are pixels. */
export interface Geometry {
  /** `S`, the side of the image. */
  readonly size: number;
  /** `w`, the frame line width. */
  readonly line: number;
  /** `g`, the gutter between cells. */
  readonly gutter: number;
  /** `t`, the side of a cell; 0 if the size leaves no room for the cells. */
  readonly cell: number;
  /** `G`, the side of the grid. */
  readonly grid: number;
  /** `o`, the offset of the grid from the left and from the top. */
  readonly offset: number;
}

/** Section 7. `frame` is a resolved style, not `automatic`. */
export function geometryOf(size: number, shape: Shape, frame: FrameStyle): Geometry {
  const line = Math.max(1, (size / 48) | 0);
  const gutter = line;
  let cell = 0;
  if (shape === "round") {
    const k = frame === "double" || frame === "thick" ? 3 : 1;
    const margin = k * line + gutter;
    const limit = (size - 2 * margin) * (size - 2 * margin);
    // The largest t with 2 * (4 t + 3 g)^2 <= (S - 2 m)^2.
    while (2 * (4 * (cell + 1) + 3 * gutter) * (4 * (cell + 1) + 3 * gutter) <= limit) {
      cell++;
    }
  } else {
    const margin = Math.max(4 * line, (size / 12) | 0);
    cell = (size - 2 * margin - 3 * gutter) >> 2;
  }
  const grid = 4 * cell + 3 * gutter;
  return { size, line, gutter, cell, grid, offset: (size - grid) >> 1 };
}

/** What `automatic` stands for: section 6. */
export function resolveFrame(frame: FrameStyle, mode: Mode, shape: Shape): FrameStyle {
  if (frame !== "automatic") {
    return frame;
  }
  return mode === "keyed" && shape === "square" ? "rounded" : "none";
}

/** The table of section 6: which resolved style goes with which shape and mode. */
export function frameAllowed(resolved: FrameStyle, mode: Mode, shape: Shape): boolean {
  switch (resolved) {
    case "none":
    case "plain":
      return true;
    case "rounded":
    case "chamfered":
    case "brackets":
      return mode === "keyed" && shape === "square";
    case "double":
    case "thick":
      return mode === "keyed";
    case "ticks":
    case "gaps":
      return mode === "keyed" && shape === "round";
    case "automatic":
      return false;
  }
}

/** The per-sample tests of sections 8.2 and 8.3. `style` is a resolved style. */
export class FrameTester {
  private readonly round: boolean;
  private readonly style: FrameStyle;
  private readonly s8: number;
  private readonly w8: number;
  private readonly r: number;
  private readonly corner: number;
  private readonly diagonal: number;
  private readonly chamfer: number;
  private readonly bracket: number;
  private readonly gap: number;
  private readonly tickEnd: number;

  /** Derives the constants of sections 8.1 to 8.3 from the geometry. */
  constructor(g: Geometry, shape: Shape, style: FrameStyle) {
    this.round = shape === "round";
    this.style = style;
    this.s8 = 8 * g.size;
    this.w8 = 8 * g.line;
    this.r = 4 * g.size;
    this.corner = Math.min(16 * g.offset, 4 * g.size);
    this.diagonal = ((this.w8 * 1414 + 500) / 1000) | 0;
    this.chamfer = Math.max(8, ((16 * g.offset - this.diagonal - this.w8) >> 3) << 3);
    this.bracket = 8 * (g.size >> 2);
    this.gap = 8 * Math.max(1, (g.size / 24) | 0);
    const inner = this.r - this.w8;
    this.tickEnd = inner - Math.max(8, (((inner - 4 * g.grid) * 6) / 10) | 0);
  }

  /** Section 8.2: is the sample (u, v) inside the outline? */
  inOutline(u: number, v: number): boolean {
    if (this.round) {
      const dx = u - this.r;
      const dy = v - this.r;
      return dx * dx + dy * dy <= this.r * this.r;
    }
    if (this.style === "rounded") {
      const du = Math.min(u, this.s8 - u);
      const dv = Math.min(v, this.s8 - v);
      if (du < this.corner && dv < this.corner) {
        const ex = this.corner - du;
        const ey = this.corner - dv;
        return ex * ex + ey * ey <= this.corner * this.corner;
      }
      return true;
    }
    if (this.style === "chamfered") {
      return Math.min(u, this.s8 - u) + Math.min(v, this.s8 - v) >= this.chamfer;
    }
    return true;
  }

  /** Section 8.3: does the sample (u, v), which is inside the outline, belong to the frame? */
  onFrame(u: number, v: number): boolean {
    const style = this.style;
    const w8 = this.w8;
    if (style === "none") {
      return false;
    }
    if (this.round) {
      const r = this.r;
      const dx = Math.abs(u - r);
      const dy = Math.abs(v - r);
      const d2 = dx * dx + dy * dy;
      const ring = d2 > (r - w8) * (r - w8);
      switch (style) {
        case "plain":
          return ring;
        case "double":
          return ring || (d2 > (r - 3 * w8) * (r - 3 * w8) && d2 <= (r - 2 * w8) * (r - 2 * w8));
        case "thick":
          return d2 > (r - 3 * w8) * (r - 3 * w8);
        case "gaps":
          return ring && Math.abs(dx - dy) >= this.gap;
        case "ticks":
          return ring || (dx < w8 && dy >= this.tickEnd) || (dy < w8 && dx >= this.tickEnd);
        default:
          return false;
      }
    }
    const du = Math.min(u, this.s8 - u);
    const dv = Math.min(v, this.s8 - v);
    const e = Math.min(du, dv);
    switch (style) {
      case "plain":
        return e < w8;
      case "double":
        return e < w8 || (e >= 2 * w8 && e < 3 * w8);
      case "thick":
        return e < 3 * w8;
      case "brackets":
        return e < w8 && Math.max(du, dv) < this.bracket;
      case "chamfered":
        return e < w8 || du + dv - this.chamfer < this.diagonal;
      case "rounded": {
        if (du < this.corner && dv < this.corner) {
          const ex = this.corner - du;
          const ey = this.corner - dv;
          return ex * ex + ey * ey > (this.corner - w8) * (this.corner - w8);
        }
        return e < w8;
      }
      default:
        return false;
    }
  }
}

/** Section 8.4: does the cell-local sample (u, v) belong to the figure? `h` is `H = 4 t`. */
export function inFigure(figure: Figure, u: number, v: number, h: number): boolean {
  switch (figure) {
    case "none":
      return false;
    case "square":
      return true;
    case "circle":
      return (u - h) * (u - h) + (v - h) * (v - h) <= h * h;
    case "triangle-up":
      return 2 * Math.abs(u - h) <= v;
    case "triangle-down":
      return 2 * Math.abs(u - h) <= 2 * h - v;
    case "triangle-right":
      return 2 * Math.abs(v - h) <= 2 * h - u;
    case "triangle-left":
      return 2 * Math.abs(v - h) <= u;
  }
}

/**
 * `MIX` of section 8.5 over the background `backgroundRgb` with the alpha `ab`: writes the four bytes of
 * the pixel into `out` at `at`. The divisions have non-negative operands below 2^31 (see `floorDiv`).
 */
export function mix(
  out: Uint8Array,
  at: number,
  rgb: number,
  a: number,
  nf: number,
  nb: number,
  backgroundRgb: number,
  ab: number,
): void {
  const total = nf * (255 * a + ab * (255 - a)) + nb * 255 * ab;
  const alpha = ((total + 2040) / 4080) | 0;
  if (alpha === 0) {
    out.fill(0, at, at + 4);
    return;
  }
  for (let c = 0, shift = 16; c < 3; c++, shift -= 8) {
    const f = (rgb >>> shift) & 0xff;
    const b = (backgroundRgb >>> shift) & 0xff;
    const p = nf * (255 * a * f + ab * (255 - a) * b) + nb * 255 * ab * b;
    out[at + c] = ((p + (total >> 1)) / total) | 0;
  }
  out[at + 3] = alpha;
}

/** Counts, for every pixel of a cell of side `t`, the samples that belong to `figure`: 0..16 each. */
function coverageOf(figure: Figure, t: number): Uint8Array {
  const counts = new Uint8Array(t * t);
  const h = 4 * t;
  for (let py = 0; py < t; py++) {
    for (let px = 0; px < t; px++) {
      let n = 0;
      for (let q = 0; q < 4; q++) {
        const v = 2 * (4 * py + q) + 1;
        for (let p = 0; p < 4; p++) {
          if (inFigure(figure, 2 * (4 * px + p) + 1, v, h)) {
            n++;
          }
        }
      }
      counts[py * t + px] = n;
    }
  }
  return counts;
}

function rasterise(
  fp: Uint8Array,
  g: Geometry,
  shape: Shape,
  frame: FrameStyle,
  backgroundRgb: number,
  ab: number,
  frameAlpha: number,
): Uint8Array<ArrayBuffer> {
  const size = g.size;
  const rgba = new Uint8Array(size * size * 4);
  const tester = new FrameTester(g, shape, frame);

  // Step 1: the surface and the frame. A pixel depends only on its two sample counts, so each pair is
  // mixed once. Inside the grid area every sample is inside the outline and off the frame, so those
  // pixels are the plain surface. The tests of sections 8.2 and 8.3 depend on a sample only through
  // du and dv, or through abs(dx) and abs(dy), so the counts of the pixel (x, y) are also those of its
  // mirror images (S - 1 - x, y), (x, S - 1 - y) and (S - 1 - x, S - 1 - y): one quadrant is evaluated.
  const mixed = new Uint8Array(17 * 17 * 4);
  const known = new Uint8Array(17 * 17);
  const gridEnd = g.offset + g.grid;
  const half = (size + 1) >> 1;
  for (let y = 0; y < half; y++) {
    const gridRow = y >= g.offset && y < gridEnd;
    const row = y * size * 4;
    for (let x = 0; x < half; x++) {
      let inside = 16;
      let onFrame = 0;
      if (!(gridRow && x >= g.offset && x < gridEnd)) {
        inside = 0;
        for (let q = 0; q < 4; q++) {
          const v = 2 * (4 * y + q) + 1;
          for (let p = 0; p < 4; p++) {
            const u = 2 * (4 * x + p) + 1;
            if (tester.inOutline(u, v)) {
              inside++;
              if (tester.onFrame(u, v)) {
                onFrame++;
              }
            }
          }
        }
      }
      const slot = inside * 17 + onFrame;
      if (known[slot] === 0) {
        mix(mixed, 4 * slot, FRAME_COLOUR, frameAlpha, onFrame, inside - onFrame, backgroundRgb, ab);
        known[slot] = 1;
      }
      const from = 4 * slot;
      const left = row + 4 * x;
      const right = row + 4 * (size - 1 - x);
      for (let c = 0; c < 4; c++) {
        rgba[left + c] = mixed[from + c];
        rgba[right + c] = mixed[from + c];
      }
    }
    rgba.copyWithin((size - 1 - y) * size * 4, row, row + size * 4);
  }

  // Step 2: the figures. The sample counts of a figure are the same in every cell that shows it.
  const cells = cellsOf(fp);
  const coverage = new Map<Figure, Uint8Array>();
  const shades = new Uint8Array(17 * 4);
  const t = g.cell;
  for (let index = 0; index < 16; index++) {
    const cell = cells[index];
    if (cell.figure === "none") {
      continue;
    }
    let counts = coverage.get(cell.figure);
    if (counts === undefined) {
      counts = coverageOf(cell.figure, t);
      coverage.set(cell.figure, counts);
    }
    for (let n = 0; n <= 16; n++) {
      mix(shades, 4 * n, PALETTE[cell.colour], 255, n, 16 - n, backgroundRgb, ab);
    }
    const x0 = g.offset + (index & 3) * (t + g.gutter);
    const y0 = g.offset + (index >> 2) * (t + g.gutter);
    for (let py = 0; py < t; py++) {
      let at = ((y0 + py) * size + x0) * 4;
      for (let px = 0; px < t; px++, at += 4) {
        const shade = 4 * counts[py * t + px];
        rgba[at] = shades[shade];
        rgba[at + 1] = shades[shade + 1];
        rgba[at + 2] = shades[shade + 2];
        rgba[at + 3] = shades[shade + 3];
      }
    }
  }
  return rgba;
}

/**
 * Renders `size * size * 4` RGBA bytes, with the checks of section 6 in their specified order, after the
 * options themselves have been validated.
 */
export function render(
  fp: Uint8Array,
  mode: Mode,
  size: number,
  options: RenderOptions | undefined,
): Uint8Array<ArrayBuffer> {
  const o = resolveOptions(options);
  if (!isIntegerIn(size, MIN_SIZE, MAX_SIZE)) {
    throw new HhError(HhErrorCode.INVALID_SIZE, `the size is an integer ${MIN_SIZE}..${MAX_SIZE}`);
  }
  const frame = resolveFrame(o.frame, mode, o.shape);
  if (!frameAllowed(frame, mode, o.shape)) {
    throw new HhError(
      HhErrorCode.INVALID_FRAME,
      `the frame ${frame} is not allowed for a ${mode} fingerprint with the ${o.shape} shape`,
    );
  }
  if (o.backgroundAlpha === 255 && figuresX100(o.backgroundRgb) < 200) {
    throw new HhError(HhErrorCode.LOW_CONTRAST, "the background is too close to a palette colour");
  }
  const g = geometryOf(size, o.shape, frame);
  if (g.cell < 1) {
    throw new HhError(HhErrorCode.INVALID_SIZE, "the size leaves no room for the cells");
  }
  return rasterise(fp, g, o.shape, frame, o.backgroundRgb, o.backgroundAlpha, o.frameAlpha);
}
