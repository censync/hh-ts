// The order in which errors are detected is part of the specification (sections 3, 6, 10 and 13): an
// input that is wrong in several ways gives the same error in every implementation.

import assert from "node:assert/strict";
import { test } from "node:test";

import { BaseDigest, FRAME_STYLES, Fingerprint, HhError, HhImage, SecretKey } from "../src/index.js";
import type { HhErrorName, RenderOptions, Shape } from "../src/index.js";

function error(block: () => unknown): HhErrorName | "ok" {
  try {
    block();
  } catch (e) {
    assert.ok(e instanceof HhError, `not an HhError: ${String(e)}`);
    return e.specName;
  }
  return "ok";
}

const bytes = Uint8Array.from({ length: 32 }, (_, i) => 7 * i + 3);
const universal = Fingerprint.fromBytes(bytes, "universal");
const keyed = Fingerprint.fromBytes(bytes, "keyed");

/** A palette colour as an opaque background: the lowest contrast there is. */
const LOW: RenderOptions = { backgroundRgb: 0x890af0 };

test("render: the size range comes before the frame and the contrast", () => {
  for (const size of [15, 1025, 0, -128, 64.5, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.equal(error(() => universal.render(size, { ...LOW, frame: "ticks" })), "invalid_size", String(size));
  }
  assert.equal(error(() => universal.render("64" as unknown as number)), "invalid_size");
  assert.equal(error(() => universal.render(undefined as unknown as number)), "invalid_size");
});

test("render: the frame comes before the contrast", () => {
  // In either mode a style that does not fit the shape is refused, and one that fits goes on to the contrast.
  for (const fp of [universal, keyed]) {
    assert.equal(error(() => fp.render(64, { ...LOW, frame: "ticks" })), "invalid_frame", fp.mode);
    assert.equal(error(() => fp.render(64, { ...LOW, shape: "round", frame: "brackets" })), "invalid_frame", fp.mode);
    assert.equal(error(() => fp.render(64, { ...LOW, frame: "thick" })), "low_contrast", fp.mode);
  }
  assert.equal(error(() => universal.render(64, LOW)), "low_contrast");
});

test("render: the contrast comes before the room for the cells", () => {
  const tight: RenderOptions = { shape: "round", frame: "double" };
  assert.equal(error(() => keyed.render(17, { ...tight, ...LOW })), "low_contrast");
  assert.equal(error(() => keyed.render(17, tight)), "invalid_size");
  assert.equal(error(() => keyed.render(17, { ...tight, frame: "thick" })), "invalid_size");
  assert.equal(error(() => keyed.render(18, tight)), "ok");
  assert.equal(error(() => keyed.render(16, { shape: "round", frame: "ticks" })), "ok");
});

test("render: the contrast rule applies to opaque backgrounds only", () => {
  assert.equal(error(() => universal.render(64, { ...LOW, backgroundAlpha: 254 })), "ok");
  assert.equal(error(() => universal.render(64, { ...LOW, backgroundAlpha: 0 })), "ok");
  assert.equal(error(() => universal.render(64, { backgroundRgb: 0x9e9e9e })), "low_contrast");
  assert.equal(error(() => universal.render(64, { backgroundRgb: 0x121212 })), "ok");
});

test("render: every frame style against every shape, in both modes", () => {
  // The shape alone decides which styles fit; the mode plays no part.
  const fitting: Readonly<Record<Shape, readonly string[]>> = {
    square: ["automatic", "none", "plain", "rounded", "chamfered", "double", "thick", "brackets"],
    round: ["automatic", "none", "plain", "double", "thick", "ticks", "gaps"],
  };
  for (const fp of [universal, keyed]) {
    for (const shape of ["square", "round"] as const) {
      for (const frame of FRAME_STYLES) {
        const expected = fitting[shape].includes(frame) ? "ok" : "invalid_frame";
        assert.equal(error(() => fp.render(48, { shape, frame })), expected, `${fp.mode} ${shape} ${frame}`);
      }
    }
  }
});

test("render: automatic is rounded for keyed and square, otherwise none", () => {
  assert.deepEqual(keyed.render(48).rgba, keyed.render(48, { frame: "rounded" }).rgba);
  assert.deepEqual(keyed.render(48, { shape: "round" }).rgba, keyed.render(48, { shape: "round", frame: "none" }).rgba);
  assert.deepEqual(universal.render(48).rgba, universal.render(48, { frame: "none" }).rgba);
});

test("render: an explicit frame draws the same for both modes", () => {
  // The frame depends on the style and the shape alone: two fingerprints with the same bytes and different
  // modes give identical pictures for every explicit style.
  let rendered = 0;
  for (const shape of ["square", "round"] as const) {
    for (const frame of FRAME_STYLES.filter((style) => style !== "automatic")) {
      const options: RenderOptions = { shape, frame };
      const name = `${shape} ${frame}`;
      assert.equal(error(() => universal.render(80, options)), error(() => keyed.render(80, options)), name);
      const a = universal.renderOrNull(80, options);
      const b = keyed.renderOrNull(80, options);
      assert.deepEqual(a?.rgba, b?.rgba, name);
      rendered += a === null ? 0 : 1;
    }
  }
  assert.equal(rendered, 13); // seven styles of the square, six of the round shape
  // Only automatic depends on the mode: keyed square pictures get rounded corners.
  const keyedAutomatic = keyed.render(80, { shape: "square", frame: "automatic" }).rgba;
  assert.deepEqual(universal.render(80, { shape: "square", frame: "rounded" }).rgba, keyedAutomatic);
  assert.notDeepEqual(universal.render(80).rgba, keyedAutomatic);
});

test("render: invalid options come before everything else", () => {
  // hh-cpp reports an unknown enumeration value as invalid_argument before it looks at the size.
  const options = { shape: "oval" } as unknown as RenderOptions;
  assert.equal(error(() => universal.render(15, options)), "invalid_argument");
  assert.equal(error(() => universal.render(15, { backgroundAlpha: 300 })), "invalid_argument");
});

test("hexadecimal input: the syntax comes before the length", () => {
  const overlong = "00".repeat(1048577);
  assert.equal(error(() => BaseDigest.ofHex(overlong)), "input_too_large");
  assert.equal(error(() => BaseDigest.ofHex(`${overlong}0`)), "invalid_hex");
  assert.equal(error(() => BaseDigest.ofHex(`${overlong} `)), "invalid_hex");
  assert.equal(error(() => BaseDigest.ofHex("0x")), "invalid_hex"); // a bare prefix, not an empty input
});

test("text input: the length comes before the surrogates", () => {
  assert.equal(error(() => BaseDigest.ofText("")), "empty_input");
  assert.equal(error(() => BaseDigest.ofText("\ud800".repeat(1048577))), "input_too_large");
  assert.equal(error(() => BaseDigest.ofText("\ud800".repeat(349526))), "input_too_large"); // 1 048 578 bytes
  assert.equal(error(() => BaseDigest.ofText("\ud800".repeat(349525))), "invalid_argument"); // 1 048 575 bytes
});

test("keyed fingerprint: the digest comes before the key", () => {
  const closed = SecretKey.of(bytes);
  closed.close();
  const notADigest = {} as unknown as BaseDigest;
  assert.equal(error(() => Fingerprint.keyed(notADigest, closed)), "invalid_digest");
  assert.equal(error(() => Fingerprint.keyed(BaseDigest.fromBytes(bytes), closed)), "invalid_key");
});

test("fingerprint import: the bytes come before the mode", () => {
  assert.equal(error(() => Fingerprint.fromBytes(new Uint8Array(31), "sideways" as "keyed")), "invalid_fingerprint");
  assert.equal(error(() => Fingerprint.fromBytes(bytes, "sideways" as "keyed")), "invalid_fingerprint");
});

test("JPEG: the image comes before the quality, the quality before the matte", () => {
  // An invalid image cannot be constructed, so invalid_image is always the first error.
  assert.equal(error(() => HhImage.ofRgba(0, 0, new Uint8Array(0)).encodeJpeg(0)), "invalid_image");
  const image = HhImage.ofRgba(1, 1, new Uint8Array(4));
  assert.equal(error(() => image.encodeJpeg(0, -1)), "invalid_quality");
  assert.equal(error(() => image.encodeJpeg(50, -1)), "invalid_argument");
  assert.equal(error(() => image.encodeJpeg(50)), "ok");
  assert.equal(error(() => image.encodeJpeg(100)), "ok");
});
