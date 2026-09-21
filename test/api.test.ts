import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import { inspect } from "node:util";
import { test } from "node:test";

import {
  BaseDigest,
  FIGURES,
  FRAME_STYLES,
  Fingerprint,
  HhError,
  HhErrorCode,
  HhImage,
  MODES,
  SHAPES,
  SecretKey,
  VERSION,
  measureContrast,
} from "../src/index.js";
import type { HhErrorName, Mode, RenderOptions } from "../src/index.js";
import { ascii, fromHex, toHex } from "./util.js";

const ADDRESS = "5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed";
const ADDRESS_DIGEST = "e212927148fcf76f6669c244a0db08bdd4f36dc50a378f6a1a3fe472807e7852";
const TEST_KEY = Uint8Array.from({ length: 32 }, (_, i) => i);

/** The error that `block` throws. */
function error(block: () => unknown): HhErrorName {
  try {
    block();
  } catch (e) {
    assert.ok(e instanceof HhError, `not an HhError: ${String(e)}`);
    assert.ok(e instanceof Error);
    assert.equal(e.name, "HhError");
    assert.notEqual(e.message, "");
    return e.specName;
  }
  return assert.fail("nothing was thrown");
}

/** A value of the wrong type, as untyped JavaScript may pass it. */
const wrong = <T>(value: unknown): T => value as T;

test("every spelling of an address gives one digest", () => {
  const expected = BaseDigest.of(fromHex(ADDRESS));
  assert.equal(toHex(expected.toBytes()), ADDRESS_DIGEST);
  for (const form of [ADDRESS, `0x${ADDRESS}`, `0X${ADDRESS.toUpperCase()}`, ADDRESS.toLowerCase()]) {
    assert.ok(BaseDigest.ofHex(form).equals(expected), form);
  }
  assert.equal(String(expected), `BaseDigest(${ADDRESS_DIGEST})`);
  assert.equal(expected.equals(BaseDigest.of(fromHex("00"))), false);
  assert.equal(expected.equals(ADDRESS_DIGEST), false);
});

test("a Buffer and a view into a larger buffer are bytes like any other", () => {
  const expected = BaseDigest.of(fromHex(ADDRESS));
  assert.ok(BaseDigest.of(Buffer.from(ADDRESS, "hex")).equals(expected));
  const padded = new Uint8Array(40);
  padded.set(fromHex(ADDRESS), 7);
  assert.ok(BaseDigest.of(padded.subarray(7, 27)).equals(expected));
});

test("text and binary inputs are separated", () => {
  const text = "bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4";
  assert.equal(BaseDigest.ofText(text).equals(BaseDigest.of(ascii(text))), false);
  assert.equal(
    toHex(BaseDigest.ofText(text).toBytes()),
    "dc705192e4a205d8c403ae7693290df45f09cec04116ad38f6140f349392548f",
  );
  assert.ok(BaseDigest.ofUtf8(ascii(text)).equals(BaseDigest.ofText(text)));
});

test("invalid inputs throw and the OrNull forms return null", () => {
  assert.equal(error(() => BaseDigest.of(new Uint8Array(0))), "empty_input");
  assert.equal(error(() => BaseDigest.ofText("")), "empty_input");
  assert.equal(error(() => BaseDigest.ofUtf8(new Uint8Array(0))), "empty_input");
  assert.equal(error(() => BaseDigest.of(new Uint8Array(1048577))), "input_too_large");
  assert.equal(error(() => BaseDigest.ofUtf8(new Uint8Array(1048577))), "input_too_large");
  assert.equal(error(() => BaseDigest.ofHex("0xzz")), "invalid_hex");
  assert.equal(error(() => BaseDigest.ofHex("")), "invalid_hex");
  assert.equal(error(() => BaseDigest.ofHex("\u0661\u0662")), "invalid_hex"); // Arabic-Indic digits
  assert.equal(error(() => BaseDigest.ofHex("\uff11\uff12")), "invalid_hex"); // fullwidth digits
  assert.equal(error(() => BaseDigest.fromBytes(new Uint8Array(31))), "invalid_digest");
  // An unpaired surrogate has no UTF-8 encoding; it must not be replaced silently.
  assert.equal(error(() => BaseDigest.ofText("a\ud800b")), "invalid_argument");
  assert.equal(BaseDigest.ofOrNull(new Uint8Array(0)), null);
  assert.equal(BaseDigest.ofHexOrNull("abc"), null);
  assert.equal(BaseDigest.ofTextOrNull("\udc00"), null);
  assert.equal(BaseDigest.ofUtf8OrNull(new Uint8Array(0)), null);
  assert.equal(BaseDigest.fromBytesOrNull(new Uint8Array(33)), null);
  assert.equal(HhImage.ofRgbaOrNull(2, 2, new Uint8Array(15)), null);
  assert.notEqual(HhImage.ofRgbaOrNull(2, 2, new Uint8Array(16)), null);
  assert.notEqual(BaseDigest.fromBytesOrNull(new Uint8Array(32)), null);
});

test("values of the wrong type are errors of the specification, never a TypeError", () => {
  for (const value of [undefined, null, 5, "00", [1, 2], new Uint16Array(4), new ArrayBuffer(4), {}]) {
    assert.equal(error(() => BaseDigest.of(wrong(value))), "invalid_argument");
    assert.equal(error(() => BaseDigest.ofUtf8(wrong(value))), "invalid_argument");
    assert.equal(error(() => BaseDigest.fromBytes(wrong(value))), "invalid_digest");
    assert.equal(error(() => SecretKey.of(wrong(value))), "invalid_key");
    assert.equal(error(() => Fingerprint.fromBytes(wrong(value), "keyed")), "invalid_fingerprint");
    assert.equal(error(() => HhImage.ofRgba(1, 1, wrong(value))), "invalid_image");
  }
  for (const value of [undefined, null, 5, new Uint8Array(2), {}]) {
    assert.equal(error(() => BaseDigest.ofHex(wrong(value))), "invalid_argument");
    assert.equal(error(() => BaseDigest.ofText(wrong(value))), "invalid_argument");
  }
  const digest = BaseDigest.fromBytes(fromHex(ADDRESS_DIGEST));
  const key = SecretKey.of(TEST_KEY);
  for (const value of [undefined, null, {}, fromHex(ADDRESS_DIGEST), key]) {
    assert.equal(error(() => Fingerprint.universal(wrong(value))), "invalid_digest");
    assert.equal(error(() => Fingerprint.keyed(wrong(value), key)), "invalid_digest");
  }
  for (const value of [undefined, null, {}, TEST_KEY, digest]) {
    assert.equal(error(() => Fingerprint.keyed(digest, wrong(value))), "invalid_key");
    assert.equal(Fingerprint.keyedOrNull(digest, wrong(value)), null);
  }
  for (const mode of [undefined, null, "", "Keyed", "private", 2]) {
    assert.equal(error(() => Fingerprint.fromBytes(new Uint8Array(32), wrong(mode))), "invalid_fingerprint");
  }
});

test("a text is checked for its length, then for surrogates", () => {
  // Every UTF-16 unit is at least one byte, so an overlong text is refused without being encoded, and
  // before its content is looked at.
  const tooLong = "a".repeat(1048577);
  assert.equal(error(() => BaseDigest.ofText(tooLong)), "input_too_large");
  assert.equal(error(() => BaseDigest.ofText(`${tooLong.slice(0, -1)}\ud800`)), "input_too_large");
  // 1 048 576 units of two bytes each are too many bytes, though not too many units.
  assert.equal(error(() => BaseDigest.ofText("\u00e9".repeat(1048576))), "input_too_large");
  // The length check comes first even when the encoder would have to give up: an unpaired surrogate
  // counts as the three bytes of its code unit.
  assert.equal(error(() => BaseDigest.ofText(`${"a".repeat(1048574)}\ud800`)), "input_too_large");
  assert.equal(error(() => BaseDigest.ofText(`${"a".repeat(1048573)}\ud800`)), "invalid_argument");
  for (const bad of ["\ud800", "\udc00", "a\ud800", "\udc00\ud800", "\ud800\ud800\udc00", "x\udbffy"]) {
    assert.equal(error(() => BaseDigest.ofText(bad)), "invalid_argument");
  }
  assert.notEqual(BaseDigest.ofTextOrNull("\udbff\udfff"), null); // the last code point, U+10FFFF
  assert.notEqual(BaseDigest.ofTextOrNull("a".repeat(1048576)), null);
});

test("hexadecimal syntax is checked before its length", () => {
  const tooLong = "a".repeat(2 * 1048577);
  assert.equal(error(() => BaseDigest.ofHex(tooLong)), "input_too_large");
  assert.equal(error(() => BaseDigest.ofHex(`0x${tooLong}`)), "input_too_large");
  assert.equal(error(() => BaseDigest.ofHex(`${tooLong.slice(0, -1)}g`)), "invalid_hex");
  assert.equal(error(() => BaseDigest.ofHex(tooLong.slice(0, -1))), "invalid_hex");
});

test("supplementary characters are encoded as four bytes", () => {
  // U+10348 is one code point, two UTF-16 units, four UTF-8 bytes.
  assert.ok(BaseDigest.ofText("\ud800\udf48").equals(BaseDigest.ofUtf8(fromHex("f0908d88"))));
  const utf8 = fromHex("636166c3a920e282ac20f0908d88");
  assert.ok(BaseDigest.ofText("caf\u00e9 \u20ac \u{10348}").equals(BaseDigest.ofUtf8(utf8)));
});

test("keys are checked", () => {
  assert.equal(error(() => SecretKey.of(new Uint8Array(31).fill(1))), "invalid_key");
  assert.equal(error(() => SecretKey.of(new Uint8Array(33).fill(1))), "invalid_key");
  assert.equal(error(() => SecretKey.of(new Uint8Array(32))), "invalid_key");
  assert.equal(SecretKey.ofOrNull(new Uint8Array(0)), null);
  assert.equal(toHex(SecretKey.of(TEST_KEY).checkValue), "6a5955cf");
});

test("a key copies its bytes and, once closed, gives only its check value", () => {
  const bytes = TEST_KEY.slice();
  const key = SecretKey.of(bytes);
  bytes.fill(0); // the caller wipes its own array; the key is not affected
  assert.equal(toHex(key.checkValue), "6a5955cf");
  const digest = BaseDigest.fromBytes(fromHex(ADDRESS_DIGEST));
  const keyed = Fingerprint.keyed(digest, key);
  assert.equal(toHex(keyed.toBytes()), "26ea8171aab23c8e1bf7c23417d33d6dba81d881af70edd2b0675348e080b478");
  assert.equal(key.closed, false);
  key.close();
  key.close();
  assert.equal(key.closed, true);
  assert.equal(error(() => Fingerprint.keyed(digest, key)), "invalid_key");
  assert.equal(Fingerprint.keyedOrNull(digest, key), null);
  // The check value is public: it was computed when the key was made and outlives the key.
  assert.equal(toHex(key.checkValue), "6a5955cf");
  key.checkValue.fill(0); // a copy
  assert.equal(toHex(key.checkValue), "6a5955cf");
  assert.throws(() => {
    (key as { closed: boolean }).closed = false;
  }, TypeError);
  assert.equal(key.closed, true);
});

test("a key does not show its bytes", () => {
  const key = SecretKey.of(TEST_KEY);
  assert.equal(String(key), "SecretKey(***)");
  assert.equal(JSON.stringify(key), "{}");
  assert.deepEqual(Object.getOwnPropertyNames(key), []);
  assert.doesNotMatch(inspect(key, { showHidden: true, depth: 5 }), /Uint8Array|\b31\b/);
});

test("fingerprints compare by bytes and mode", () => {
  const digest = BaseDigest.fromBytes(fromHex(ADDRESS_DIGEST));
  const universal = Fingerprint.universal(digest);
  assert.equal(universal.mode, "universal");
  assert.equal(universal.tag, "TKSPVH");
  assert.equal(String(universal), "Fingerprint(universal, TKSPVH)");
  assert.ok(universal.equals(Fingerprint.fromBytes(fromHex(ADDRESS_DIGEST), "universal")));
  assert.equal(universal.equals(Fingerprint.fromBytes(fromHex(ADDRESS_DIGEST), "keyed")), false);
  assert.equal(universal.equals(digest), false);
  assert.equal(error(() => Fingerprint.fromBytes(new Uint8Array(16), "keyed")), "invalid_fingerprint");
  assert.equal(Fingerprint.fromBytesOrNull(new Uint8Array(64), "keyed"), null);
  // The arrays handed out are copies, and the arrays taken in are copied.
  universal.toBytes().fill(0);
  assert.equal(toHex(universal.toBytes()), ADDRESS_DIGEST);
  const source = fromHex(ADDRESS_DIGEST);
  const imported = Fingerprint.fromBytes(source, "keyed");
  source.fill(0);
  assert.equal(toHex(imported.toBytes()), ADDRESS_DIGEST);
});

test("digests and fingerprints cannot be changed", () => {
  const digest = BaseDigest.fromBytes(fromHex(ADDRESS_DIGEST));
  const fp = Fingerprint.fromBytes(fromHex(ADDRESS_DIGEST), "universal");
  const before = fp.render(32, { frame: "none" }).rgba;
  for (const object of [digest, fp, SecretKey.of(TEST_KEY)]) {
    assert.ok(Object.isFrozen(object));
    assert.deepEqual(Object.getOwnPropertyNames(object), []);
    assert.equal(JSON.stringify(object), "{}");
    assert.throws(() => {
      (object as unknown as { bytes: Uint8Array }).bytes = new Uint8Array(32);
    }, TypeError);
  }
  assert.throws(() => {
    (fp as { mode: Mode }).mode = "keyed";
  }, TypeError);
  assert.throws(() => {
    (fp as { tag: string }).tag = "000000";
  }, TypeError);
  assert.equal(fp.mode, "universal");
  assert.equal(fp.tag, "TKSPVH");
  assert.equal(error(() => fp.render(32, { frame: "rounded" })), "invalid_frame"); // still universal
  assert.deepEqual(fp.render(32, { frame: "none" }).rgba, before);
  // The bytes are not a property: nothing prints them and nothing reaches them but toBytes(), a copy.
  assert.equal((fp as unknown as { bytes?: unknown }).bytes, undefined);
  assert.equal((digest as unknown as { bytes?: unknown }).bytes, undefined);
  assert.doesNotMatch(inspect(fp, { showHidden: true, depth: 5 }), /Uint8Array/);
  assert.doesNotMatch(inspect(digest, { showHidden: true, depth: 5 }), /Uint8Array/);
  digest.toBytes().fill(0);
  assert.equal(toHex(digest.toBytes()), ADDRESS_DIGEST);
  assert.ok(digest.equals(BaseDigest.fromBytes(fromHex(ADDRESS_DIGEST))));
  assert.ok(fp.equals(Fingerprint.universal(digest)));
});

test("an object with the prototype of a class is not one of its instances", () => {
  const digest = BaseDigest.fromBytes(fromHex(ADDRESS_DIGEST));
  const key = SecretKey.of(TEST_KEY);
  const fp = Fingerprint.universal(digest);
  assert.equal(error(() => Fingerprint.universal(Object.create(BaseDigest.prototype))), "invalid_digest");
  assert.equal(error(() => Fingerprint.keyed(Object.create(BaseDigest.prototype), key)), "invalid_digest");
  assert.equal(error(() => Fingerprint.keyed(digest, Object.create(SecretKey.prototype))), "invalid_key");
  assert.equal(Fingerprint.keyedOrNull(digest, Object.create(SecretKey.prototype)), null);
  assert.equal(digest.equals(Object.create(BaseDigest.prototype)), false);
  assert.equal(fp.equals(Object.create(Fingerprint.prototype)), false);
});

test("the tag is Crockford Base32 of the top 30 bits of bytes 16..19", () => {
  const bytes = new Uint8Array(32);
  assert.equal(Fingerprint.fromBytes(bytes, "universal").tag, "000000");
  bytes.set([0xff, 0xff, 0xff, 0xff], 16);
  assert.equal(Fingerprint.fromBytes(bytes, "universal").tag, "ZZZZZZ");
  bytes.set([0x00, 0x00, 0x00, 0x03], 16); // the two low bits are not part of the tag
  assert.equal(Fingerprint.fromBytes(bytes, "universal").tag, "000000");
  bytes.set([0x08, 0x86, 0x42, 0x98], 16); // 00001 00010 00011 00100 00101 00110 00
  assert.equal(Fingerprint.fromBytes(bytes, "universal").tag, "123456");
});

test("the layout describes the cells", () => {
  const bytes = new Uint8Array(32);
  for (let i = 0; i < 16; i++) {
    bytes[i] = ((i >> 1) << 5) | ((i % 4) << 3) | 7;
  }
  const layout = Fingerprint.fromBytes(bytes, "keyed").layout();
  const figures = [
    "none", "none", "square", "circle", "triangle-up", "triangle-right", "triangle-down", "triangle-left",
  ];
  assert.equal(layout.mode, "keyed");
  assert.equal(layout.cells.length, 16);
  layout.cells.forEach((cell, i) => {
    assert.equal(cell.figure, figures[i >> 1], `cell ${i}`);
    assert.equal(cell.colour, cell.figure === "none" ? 0 : i % 4, `cell ${i}`);
  });
  assert.deepEqual(layout.paletteRgb, [0x7a96c5, 0x890af0, 0xc10445, 0xd48200]);
  assert.equal(layout.frameRgb, 0x808080);
});

test("the names are those of the specification, in its order", () => {
  assert.deepEqual(MODES, ["universal", "keyed"]);
  assert.deepEqual(SHAPES, ["square", "round"]);
  assert.deepEqual(FRAME_STYLES, [
    "automatic", "none", "plain", "rounded", "chamfered", "double", "thick", "brackets", "ticks", "gaps",
  ]);
  assert.deepEqual(FIGURES, [
    "none", "square", "circle", "triangle-up", "triangle-right", "triangle-down", "triangle-left",
  ]);
  assert.match(VERSION, /^\d+\.\d+\.\d+$/);
});

test("the names and the error codes are frozen", () => {
  for (const names of [MODES, SHAPES, FRAME_STYLES, FIGURES]) {
    assert.ok(Object.isFrozen(names));
    assert.throws(() => (names as unknown as string[]).push("evil"), TypeError);
    assert.throws(() => {
      (names as unknown as string[])[0] = "evil";
    }, TypeError);
  }
  assert.ok(Object.isFrozen(HhErrorCode));
  assert.throws(() => {
    (HhErrorCode as { INVALID_HEX: number }).INVALID_HEX = 14;
  }, TypeError);
  assert.equal(HhErrorCode.INVALID_HEX, 3);
  const fp = Fingerprint.fromBytes(new Uint8Array(32), "keyed");
  assert.equal(error(() => Fingerprint.fromBytes(new Uint8Array(32), wrong("evil"))), "invalid_fingerprint");
  assert.equal(error(() => fp.render(64, { shape: wrong("evil") })), "invalid_argument");
  assert.equal(error(() => fp.render(64, { frame: wrong("evil") })), "invalid_argument");
  // Every name the arrays list is accepted.
  for (const mode of MODES) {
    assert.equal(Fingerprint.fromBytes(new Uint8Array(32), mode).mode, mode);
  }
  for (const shape of SHAPES) {
    assert.equal(fp.render(64, { shape, frame: "plain" }).width, 64);
    for (const frame of FRAME_STYLES) {
      const e = fp.renderOrNull(64, { shape, frame }) === null ? error(() => fp.render(64, { shape, frame })) : "";
      assert.ok(e === "" || e === "invalid_frame", `${shape} ${frame}: ${e}`);
    }
  }
});

test("render options are validated", () => {
  const fp = Fingerprint.fromBytes(fromHex(ADDRESS_DIGEST), "keyed");
  const bad: unknown[] = [
    { backgroundRgb: 0x1000000 },
    { backgroundRgb: -1 },
    { backgroundRgb: 0.5 },
    { backgroundRgb: "ffffff" },
    { backgroundAlpha: 256 },
    { backgroundAlpha: Number.NaN },
    { frameAlpha: -1 },
    { frameAlpha: 1.5 },
    { shape: "oval" },
    { shape: null },
    { frame: "dotted" },
    { frame: 3 },
    // A name that is not an option, such as a misspelt one, is refused instead of being ignored.
    { backgroundRGB: 0x121212 },
    { background: 0x121212 },
    { Shape: "round" },
    { shape: "round", size: 64 },
    { "": 0 },
    { unknown: undefined },
    [0],
    null,
    "round",
    7,
  ];
  for (const options of bad) {
    assert.equal(error(() => fp.render(64, wrong(options))), "invalid_argument", inspect(options));
    assert.equal(error(() => measureContrast(wrong(options))), "invalid_argument", inspect(options));
    assert.equal(fp.renderOrNull(64, wrong(options)), null);
  }
  assert.equal(error(() => measureContrast({}, -5)), "invalid_argument");
  assert.equal(error(() => measureContrast({}, wrong("ffffff"))), "invalid_argument");
  // Only own enumerable string keys count: what an object inherits or hides is not an option.
  const inherited: RenderOptions = Object.create({ backgroundRGB: 0x121212 });
  const hidden: RenderOptions = Object.defineProperty({ [Symbol("note")]: 1 }, "note", { value: 1, enumerable: false });
  assert.deepEqual(fp.render(32, inherited).rgba, fp.render(32).rgba);
  assert.deepEqual(fp.render(32, hidden).rgba, fp.render(32).rgba);
  assert.deepEqual(measureContrast(hidden), measureContrast());
  // Properties that are absent or undefined take their defaults.
  const defaults: RenderOptions = { shape: undefined, frame: undefined, backgroundRgb: undefined };
  assert.deepEqual(fp.render(32, defaults).rgba, fp.render(32).rgba);
  assert.deepEqual(fp.render(32, {}).rgba, fp.render(32, { shape: "square", frame: "rounded" }).rgba);
});

test("contrast is measured over the page", () => {
  assert.deepEqual(measureContrast(), { figuresX100: 300, frameX100: 394 });
  assert.equal(measureContrast({ backgroundAlpha: 0 }, 0x121212).figuresX100, 300);
  assert.equal(measureContrast({ backgroundAlpha: 0 }, 0x9e9e9e).figuresX100, 112);
  // An opaque background hides the page.
  const dark: RenderOptions = { backgroundRgb: 0x121212 };
  assert.deepEqual(measureContrast(dark, 0x9e9e9e), measureContrast(dark));
  // A transparent frame has the contrast 1:1.
  assert.equal(measureContrast({ frameAlpha: 0 }).frameX100, 100);
});

test("an image holds its own pixels", () => {
  const fp = Fingerprint.fromBytes(fromHex(ADDRESS_DIGEST), "keyed");
  const image = fp.render(64);
  assert.equal(image.width, 64);
  assert.equal(image.height, 64);
  assert.equal(image.rgba.length, 64 * 64 * 4);
  assert.equal(image.rgba.byteOffset, 0);
  assert.equal(image.rgba.buffer.byteLength, image.rgba.length);
  assert.deepEqual([...image.rgba.subarray(0, 4)], [0, 0, 0, 0]); // outside the rounded corner: transparent
  assert.ok(Object.isFrozen(image));
  assert.throws(() => {
    (image as { width: number }).width = 1;
  }, TypeError);
  // Every render is a new array.
  image.rgba.fill(0);
  assert.notDeepEqual(fp.render(64).rgba, image.rgba);
  // ofRgba copies.
  const source = new Uint8Array(16).fill(0xff);
  const wrapped = HhImage.ofRgba(2, 2, source);
  source.fill(0);
  assert.deepEqual(wrapped.rgba, new Uint8Array(16).fill(0xff));
});

test("encoders check their arguments", () => {
  const image = Fingerprint.fromBytes(fromHex(ADDRESS_DIGEST), "universal").render(32);
  const qualities = [49, 101, 75.5, Number.NaN, Number.POSITIVE_INFINITY, wrong<number>("92"), wrong<number>(null)];
  for (const quality of qualities) {
    assert.equal(error(() => image.encodeJpeg(quality)), "invalid_quality", String(quality));
  }
  assert.equal(error(() => image.encodeBmp(0x1000000)), "invalid_argument");
  assert.equal(error(() => image.encodeJpeg(92, -1)), "invalid_argument");
  assert.equal(error(() => image.encodeJpeg(92, 0.5)), "invalid_argument");
  // The quality is checked before the matte.
  assert.equal(error(() => image.encodeJpeg(49, -1)), "invalid_quality");
  assert.equal(error(() => HhImage.ofRgba(0, 1, new Uint8Array(0))), "invalid_image");
  assert.equal(error(() => HhImage.ofRgba(2, 2, new Uint8Array(15))), "invalid_image");
  assert.equal(error(() => HhImage.ofRgba(4097, 1, new Uint8Array(4097 * 4))), "invalid_image");
  assert.equal(error(() => HhImage.ofRgba(1.5, 2, new Uint8Array(12))), "invalid_image");
  assert.equal(error(() => HhImage.ofRgba(wrong("2"), 2, new Uint8Array(16))), "invalid_image");
  assert.deepEqual(image.encodePng(), HhImage.ofRgba(32, 32, image.rgba).encodePng());
  assert.deepEqual(image.encodeJpeg(), image.encodeJpeg(HhImage.DEFAULT_JPEG_QUALITY, 0xffffff));
  assert.deepEqual(image.encodeBmp(), image.encodeBmp(0xffffff));
  assert.notEqual(HhImage.ofRgbaOrNull(4096, 1, new Uint8Array(4096 * 4)), null);
});

/** Detaches `buffer` the way a transfer to a worker does, or returns false where the runtime cannot. */
function detach(buffer: ArrayBuffer): boolean {
  const transferable = buffer as ArrayBuffer & { transfer?: () => ArrayBuffer };
  if (typeof transferable.transfer === "function") {
    transferable.transfer();
  } else if (typeof structuredClone === "function") {
    structuredClone(buffer, { transfer: [buffer] });
  } else {
    return false;
  }
  return buffer.byteLength === 0;
}

test("an image whose pixels were transferred away does not encode", (t) => {
  const fp = Fingerprint.fromBytes(fromHex(ADDRESS_DIGEST), "universal");
  const image = fp.render(32);
  const wrapped = HhImage.ofRgba(2, 2, new Uint8Array(16).fill(0xff));
  const png = image.encodePng();
  if (!detach(image.rgba.buffer) || !detach(wrapped.rgba.buffer)) {
    t.skip("this runtime cannot detach an ArrayBuffer");
    return;
  }
  assert.equal(image.rgba.length, 0);
  for (const detached of [image, wrapped]) {
    assert.equal(error(() => detached.encodePng()), "invalid_image");
    assert.equal(error(() => detached.encodeBmp()), "invalid_image");
    assert.equal(error(() => detached.encodeJpeg()), "invalid_image");
    // The image is checked before the quality and the matte.
    assert.equal(error(() => detached.encodeJpeg(49, -1)), "invalid_image");
    assert.equal(error(() => detached.encodeBmp(-1)), "invalid_image");
  }
  // A detached array is an empty input everywhere else.
  assert.equal(error(() => BaseDigest.of(image.rgba)), "empty_input");
  assert.equal(error(() => HhImage.ofRgba(32, 32, image.rgba)), "invalid_image");
  assert.deepEqual(fp.render(32).encodePng(), png);
});

test("error codes match the specification", () => {
  const expected: readonly (readonly [string, number, HhErrorName])[] = [
    ["EMPTY_INPUT", 1, "empty_input"],
    ["INPUT_TOO_LARGE", 2, "input_too_large"],
    ["INVALID_HEX", 3, "invalid_hex"],
    ["INVALID_KEY", 4, "invalid_key"],
    ["INVALID_DIGEST", 5, "invalid_digest"],
    ["INVALID_FINGERPRINT", 6, "invalid_fingerprint"],
    ["INVALID_SIZE", 7, "invalid_size"],
    ["INVALID_FRAME", 8, "invalid_frame"],
    ["LOW_CONTRAST", 9, "low_contrast"],
    ["INVALID_QUALITY", 10, "invalid_quality"],
    ["INVALID_IMAGE", 11, "invalid_image"],
    ["INVALID_ARGUMENT", 14, "invalid_argument"],
  ];
  assert.deepEqual(Object.entries(HhErrorCode), expected.map(([name, code]) => [name, code]));
  for (const [name, code, specName] of expected) {
    const e = new HhError(code as HhErrorCode, "text");
    assert.equal(e.code, code, name);
    assert.equal(e.specName, specName, name);
    assert.equal(specName, name.toLowerCase());
    assert.equal(e.message, "text");
  }
});

test("the modes of one input give unrelated fingerprints", () => {
  const digest = BaseDigest.fromBytes(fromHex(ADDRESS_DIGEST));
  const key = SecretKey.of(TEST_KEY);
  const other = SecretKey.of(new Uint8Array(32).fill(0xff));
  const fingerprints = [
    Fingerprint.universal(digest),
    Fingerprint.keyed(digest, key),
    Fingerprint.keyed(digest, other),
  ];
  const seen = new Set(fingerprints.map((fp) => toHex(fp.toBytes())));
  assert.equal(seen.size, 3);
  assert.deepEqual(fingerprints.map((fp): Mode => fp.mode), ["universal", "keyed", "keyed"]);
});

test("a host can compute the keyed fingerprint elsewhere, for example with WebCrypto", async () => {
  // docs/INTEGRATION.md, section 6: a non-extractable HMAC key signs M2, the library sees the result only.
  const digest = BaseDigest.fromBytes(fromHex(ADDRESS_DIGEST));
  const algorithm = { name: "HMAC", hash: "SHA-256" };
  const hmacKey = await webcrypto.subtle.importKey("raw", TEST_KEY, algorithm, false, ["sign"]);
  const m2 = new Uint8Array(47);
  m2.set(ascii("HumanizedHash"));
  m2[14] = 0x02;
  m2.set(digest.toBytes(), 15);
  const imported = Fingerprint.fromBytes(new Uint8Array(await webcrypto.subtle.sign("HMAC", hmacKey, m2)), "keyed");
  const key = SecretKey.of(TEST_KEY);
  assert.ok(imported.equals(Fingerprint.keyed(digest, key)));
  const m3 = m2.slice(0, 15);
  m3[14] = 0x03;
  const kcv = new Uint8Array(await webcrypto.subtle.sign("HMAC", hmacKey, m3)).subarray(0, 4);
  assert.equal(toHex(kcv), toHex(key.checkValue));
});
