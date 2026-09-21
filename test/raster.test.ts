// The renderer takes shortcuts: it evaluates one quadrant of the frame, skips the grid area, mixes every
// pair of sample counts once and counts the samples of a figure once per render. This test compares it
// with a straightforward implementation of SPEC.md sections 7 and 8 that evaluates every sample of every
// pixel and mixes every pixel, written from the specification alone.

import assert from "node:assert/strict";
import { test } from "node:test";

import { Fingerprint } from "../src/index.js";
import type { FrameStyle, Mode, RenderOptions, Shape } from "../src/index.js";
import { FrameTester, geometryOf } from "../src/raster.js";
import { Lcg } from "./util.js";

const PALETTE = [0x7a96c5, 0x890af0, 0xc10445, 0xd48200];
const FRAME = 0x808080;

// Exact for the small non-negative operands of sections 7 and 8; int.test.ts checks the claim.
const floorDiv = (a: number, b: number): number => Math.floor(a / b);
const channels = (rgb: number): number[] => [(rgb >> 16) & 0xff, (rgb >> 8) & 0xff, rgb & 0xff];

/** `MIX` of section 8.5. */
function mix(f: number[], a: number, nf: number, nb: number, b: number[], ab: number): number[] {
  const total = nf * (255 * a + ab * (255 - a)) + nb * 255 * ab;
  const alpha = floorDiv(total + 2040, 4080);
  if (alpha === 0) {
    return [0, 0, 0, 0];
  }
  const pixel = [0, 1, 2].map((c) => {
    const p = nf * (255 * a * (f[c] as number) + ab * (255 - a) * (b[c] as number)) + nb * 255 * ab * (b[c] as number);
    return floorDiv(p + floorDiv(total, 2), total);
  });
  return [...pixel, alpha];
}

/** The options of one comparison, all given. */
interface Look extends RenderOptions {
  readonly backgroundRgb: number;
  readonly backgroundAlpha: number;
  readonly frameAlpha: number;
}

/** Sections 7 and 8, sample by sample. `frame` is a resolved style. */
function reference(fp: Fingerprint, size: number, shape: Shape, frame: FrameStyle, o: Look): Uint8Array {
  const S = size;
  const w = Math.max(1, floorDiv(S, 48));
  const g = w;
  let t = 0;
  if (shape === "square") {
    const m = Math.max(4 * w, floorDiv(S, 12));
    t = floorDiv(S - 2 * m - 3 * g, 4);
  } else {
    const m = (frame === "double" || frame === "thick" ? 3 : 1) * w + g;
    while (2 * (4 * (t + 1) + 3 * g) ** 2 <= (S - 2 * m) ** 2) {
      t++;
    }
  }
  const G = 4 * t + 3 * g;
  const off = floorDiv(S - G, 2);
  const W8 = 8 * w;
  const S8 = 8 * S;
  const r = 4 * S;
  const R = Math.min(16 * off, 4 * S);
  const D = floorDiv(W8 * 1414 + 500, 1000);
  const C = Math.max(8, 8 * floorDiv(16 * off - D - W8, 8));
  const I = r - W8;
  const Q = I - Math.max(8, floorDiv((I - 4 * G) * 6, 10));

  const inOutline = (U: number, V: number): boolean => {
    const du = Math.min(U, S8 - U);
    const dv = Math.min(V, S8 - V);
    if (shape === "round") {
      return (U - r) ** 2 + (V - r) ** 2 <= r ** 2;
    }
    if (frame === "rounded") {
      return !(du < R && dv < R) || (R - du) ** 2 + (R - dv) ** 2 <= R ** 2;
    }
    return frame === "chamfered" ? du + dv >= C : true;
  };
  const look = `${shape} ${frame}`;
  const onFrame = (U: number, V: number): boolean => {
    const du = Math.min(U, S8 - U);
    const dv = Math.min(V, S8 - V);
    const e = Math.min(du, dv);
    const dx = U - r;
    const dy = V - r;
    const d2 = dx ** 2 + dy ** 2;
    switch (look) {
      case "square plain":
        return e < W8;
      case "square double":
        return e < W8 || (2 * W8 <= e && e < 3 * W8);
      case "square thick":
        return e < 3 * W8;
      case "square brackets":
        return e < W8 && Math.max(du, dv) < 8 * floorDiv(S, 4);
      case "square chamfered":
        return e < W8 || du + dv - C < D;
      case "square rounded":
        return du < R && dv < R ? (R - du) ** 2 + (R - dv) ** 2 > (R - W8) ** 2 : e < W8;
      case "round plain":
        return d2 > (r - W8) ** 2;
      case "round double":
        return d2 > (r - W8) ** 2 || ((r - 3 * W8) ** 2 < d2 && d2 <= (r - 2 * W8) ** 2);
      case "round thick":
        return d2 > (r - 3 * W8) ** 2;
      case "round gaps":
        return d2 > (r - W8) ** 2 && Math.abs(Math.abs(dx) - Math.abs(dy)) >= 8 * Math.max(1, floorDiv(S, 24));
      case "round ticks":
        return (
          d2 > (r - W8) ** 2 ||
          (Math.abs(dx) < W8 && Math.abs(dy) >= Q) ||
          (Math.abs(dy) < W8 && Math.abs(dx) >= Q)
        );
      default:
        return false;
    }
  };
  const H = 4 * t;
  const inFigure = (figure: string, u: number, v: number): boolean => {
    switch (figure) {
      case "square":
        return true;
      case "circle":
        return (u - H) ** 2 + (v - H) ** 2 <= H ** 2;
      case "triangle-up":
        return 2 * Math.abs(u - H) <= v;
      case "triangle-down":
        return 2 * Math.abs(u - H) <= 2 * H - v;
      case "triangle-right":
        return 2 * Math.abs(v - H) <= 2 * H - u;
      case "triangle-left":
        return 2 * Math.abs(v - H) <= u;
      default:
        return false;
    }
  };

  const background = channels(o.backgroundRgb);
  const rgba = new Uint8Array(S * S * 4);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      let nin = 0;
      let nfr = 0;
      for (let q = 0; q < 4; q++) {
        for (let p = 0; p < 4; p++) {
          const U = 2 * (4 * x + p) + 1;
          const V = 2 * (4 * y + q) + 1;
          if (inOutline(U, V)) {
            nin++;
            nfr += onFrame(U, V) ? 1 : 0;
          }
        }
      }
      rgba.set(mix(channels(FRAME), o.frameAlpha, nfr, nin - nfr, background, o.backgroundAlpha), (y * S + x) * 4);
    }
  }
  fp.layout().cells.forEach((cell, i) => {
    if (cell.figure === "none") {
      return;
    }
    const x0 = off + (i % 4) * (t + g);
    const y0 = off + floorDiv(i, 4) * (t + g);
    for (let py = 0; py < t; py++) {
      for (let px = 0; px < t; px++) {
        let nc = 0;
        for (let q = 0; q < 4; q++) {
          for (let p = 0; p < 4; p++) {
            nc += inFigure(cell.figure, 2 * (4 * px + p) + 1, 2 * (4 * py + q) + 1) ? 1 : 0;
          }
        }
        const pixel = mix(channels(PALETTE[cell.colour] as number), 255, nc, 16 - nc, background, o.backgroundAlpha);
        rgba.set(pixel, ((y0 + py) * S + x0 + px) * 4);
      }
    }
  });
  return rgba;
}

const LOOKS: readonly (readonly [Shape, FrameStyle, Mode])[] = [
  ["square", "none", "universal"],
  ["square", "plain", "universal"],
  ["square", "rounded", "keyed"],
  ["square", "chamfered", "keyed"],
  ["square", "double", "keyed"],
  ["square", "thick", "keyed"],
  ["square", "brackets", "keyed"],
  ["round", "none", "universal"],
  ["round", "plain", "keyed"],
  ["round", "double", "keyed"],
  ["round", "thick", "keyed"],
  ["round", "ticks", "keyed"],
  ["round", "gaps", "keyed"],
];

// A background that passes the contrast rule when it is opaque.
const BACKGROUNDS: readonly (readonly [rgb: number, alpha: number])[] = [
  [0xffffff, 255],
  [0x121212, 255],
  [0x000000, 0],
  [0x3366cc, 128],
  [0xf2f2f2, 254],
  [0x00ff00, 1],
];

function compare(random: Lcg, size: number, look: readonly [Shape, FrameStyle, Mode]): void {
  const [shape, frame, mode] = look;
  const [backgroundRgb, backgroundAlpha] = random.pick(BACKGROUNDS);
  const frameAlpha = random.pick([255, 255, 0, 1, 128, random.nextInt(256)]);
  const options: Look = { shape, frame, backgroundRgb, backgroundAlpha, frameAlpha };
  const fp = Fingerprint.fromBytes(random.nextBytes(32), mode);
  const name = `${size} px ${shape} ${frame} ${backgroundRgb.toString(16)}/${backgroundAlpha} frame ${frameAlpha}`;
  if (shape === "round" && (frame === "double" || frame === "thick") && size < 18) {
    assert.equal(fp.renderOrNull(size, options), null, name);
    return;
  }
  const expected = reference(fp, size, shape, frame, options);
  assert.ok(Buffer.from(fp.render(size, options).rgba).equals(expected), name);
}

test("every size 16..96 in every look equals the per-sample reference", () => {
  const random = new Lcg(20260921);
  for (let size = 16; size <= 96; size++) {
    for (const look of LOOKS) {
      compare(random, size, look);
    }
  }
});

test("larger and odd sizes equal the per-sample reference", () => {
  const random = new Lcg(8);
  for (const size of [127, 128, 129, 255, 256, 383]) {
    for (const look of LOOKS) {
      compare(random, size, look);
    }
  }
});

test("the largest size equals the per-sample reference", () => {
  const random = new Lcg(9);
  compare(random, 1024, ["square", "rounded", "keyed"]);
});

test("every sample inside the grid area is inside the outline and off the frame", () => {
  // The shortcut of step 1 and the claim of section 8.5, checked sample by sample.
  for (let size = 16; size <= 1024; size += size < 128 ? 1 : 61) {
    for (const [shape, frame] of LOOKS) {
      const g = geometryOf(size, shape, frame);
      if (g.cell < 1) {
        continue;
      }
      const tester = new FrameTester(g, shape, frame);
      // The border samples of the grid area are the closest to the frame and to the outline.
      for (let k = 8 * g.offset + 1; k < 8 * (g.offset + g.grid); k += 2) {
        for (const edge of [8 * g.offset + 1, 8 * (g.offset + g.grid) - 1]) {
          for (const [u, v] of [[k, edge], [edge, k]] as const) {
            assert.ok(tester.inOutline(u, v) && !tester.onFrame(u, v), `${size} px ${shape} ${frame} at ${u},${v}`);
          }
        }
      }
    }
  }
});
