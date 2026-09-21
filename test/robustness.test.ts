// Deterministic pseudo-random loops: any input gives a result or an HhError, never anything else.

import assert from "node:assert/strict";
import { test } from "node:test";

import { decodeHex } from "../src/derive.js";
import { BaseDigest, FRAME_STYLES, Fingerprint, HhError, HhImage, MODES, SHAPES, SecretKey } from "../src/index.js";
import { measureContrast } from "../src/index.js";
import type { RenderOptions } from "../src/index.js";
import { Lcg, toHex } from "./util.js";

test("random fingerprints render with random options", () => {
  const random = new Lcg(0xf00d);
  let rendered = 0;
  for (let i = 0; i < 1500; i++) {
    const fp = Fingerprint.fromBytes(random.nextBytes(32), random.pick(MODES));
    const options: RenderOptions = {
      shape: random.pick(SHAPES),
      frame: random.pick(FRAME_STYLES),
      backgroundRgb: random.nextInt(0x1000000),
      backgroundAlpha: random.nextInt(3) === 0 ? 255 : random.nextInt(256),
      frameAlpha: random.nextInt(256),
    };
    const size = random.nextInt(100) === 0 ? random.nextInt(2000) : 8 + random.nextInt(90);
    try {
      const image = fp.render(size, options);
      rendered++;
      assert.equal(image.width, size);
      assert.equal(image.height, size);
      assert.equal(image.rgba.length, size * size * 4);
      for (let p = 0; p < image.rgba.length; p += 4) {
        // A transparent pixel is 00 00 00 00.
        if (image.rgba[p + 3] === 0) {
          assert.equal((image.rgba[p] as number) | (image.rgba[p + 1] as number) | (image.rgba[p + 2] as number), 0);
        }
      }
    } catch (e) {
      assert.ok(e instanceof HhError, String(e));
      assert.ok(["invalid_size", "invalid_frame", "low_contrast"].includes(e.specName), e.specName);
    }
  }
  assert.ok(rendered > 200, `only ${rendered} renders succeeded`);
});

test("hexadecimal parsing agrees with a simple oracle", () => {
  const random = new Lcg(0xa11ce);
  const alphabet = "0123456789abcdefABCDEFxXgG -:\n";
  for (let i = 0; i < 4000; i++) {
    let text = random.nextInt(4) === 0 ? random.pick(["0x", "0X"]) : "";
    for (let k = random.nextInt(12); k > 0; k--) {
      text += alphabet[random.nextInt(10) < 9 ? random.nextInt(22) : random.nextInt(30)];
    }
    const digits = /^0[xX]/.test(text) ? text.slice(2) : text;
    const valid = /^([0-9a-fA-F]{2})+$/.test(digits);
    let decoded: Uint8Array | null = null;
    try {
      decoded = decodeHex(text);
    } catch (e) {
      assert.ok(e instanceof HhError && e.specName === "invalid_hex", JSON.stringify(text));
    }
    assert.equal(decoded !== null, valid, JSON.stringify(text));
    if (decoded !== null) {
      assert.equal(toHex(decoded), digits.toLowerCase());
    }
  }
});

/** A plain object that claims to be a `Uint8Array`, as `Object.prototype.toString` would believe. */
function spoof(length: number): unknown {
  return { [Symbol.toStringTag]: "Uint8Array", length, 0: 1, byteLength: length, buffer: new ArrayBuffer(length) };
}

/** A real `Uint8Array` whose `length` says `claimed`. */
function liar(actual: number, claimed: number): Uint8Array {
  class Liar extends Uint8Array {
    override get length(): number {
      return claimed;
    }
  }
  return new Liar(actual).fill(7);
}

/** A real `Uint8Array` whose properties throw. */
function thrower(size: number): Uint8Array {
  class Thrower extends Uint8Array {
    override get length(): number {
      throw new RangeError("length");
    }
    override get byteLength(): number {
      throw new RangeError("byteLength");
    }
    static get [Symbol.species](): Uint8ArrayConstructor {
      throw new RangeError("species");
    }
  }
  return new Thrower(size).fill(7);
}

test("only a real Uint8Array is bytes, and its real length counts", () => {
  const any = <T>(v: unknown): T => v as T;
  const impostors: unknown[] = [
    spoof(32), spoof(4), new Proxy(new Uint8Array(32).fill(1), {}), new Proxy(spoof(32) as object, {}),
    new Int8Array(32).fill(1), new Uint8ClampedArray(32).fill(1), new Uint16Array(16).fill(1),
    new Uint32Array(8).fill(1), new Float32Array(8).fill(1), new Float64Array(4).fill(1),
    new BigUint64Array(4).fill(1n), new DataView(new ArrayBuffer(32)), new ArrayBuffer(32),
    new SharedArrayBuffer(32), Array.from({ length: 32 }, () => 1), { length: 32 },
    Object.create(Uint8Array.prototype),
  ];
  const expected: readonly (readonly [string, (v: unknown) => unknown, (v: unknown) => unknown])[] = [
    ["invalid_argument", (v) => BaseDigest.of(any(v)), (v) => BaseDigest.ofOrNull(any(v))],
    ["invalid_argument", (v) => BaseDigest.ofUtf8(any(v)), (v) => BaseDigest.ofUtf8OrNull(any(v))],
    ["invalid_digest", (v) => BaseDigest.fromBytes(any(v)), (v) => BaseDigest.fromBytesOrNull(any(v))],
    ["invalid_key", (v) => SecretKey.of(any(v)), (v) => SecretKey.ofOrNull(any(v))],
    [
      "invalid_fingerprint",
      (v) => Fingerprint.fromBytes(any(v), "keyed"),
      (v) => Fingerprint.fromBytesOrNull(any(v), "keyed"),
    ],
    ["invalid_image", (v) => HhImage.ofRgba(4, 2, any(v)), (v) => HhImage.ofRgbaOrNull(4, 2, any(v))],
  ];
  for (const value of impostors) {
    for (const [name, throwing, orNull] of expected) {
      const label = `${name}: ${Object.prototype.toString.call(value)}`;
      assert.throws(() => throwing(value), (e) => e instanceof HhError && e.specName === name, label);
      assert.equal(orNull(value), null, label);
    }
  }

  // A subclass may say anything about its length; the library counts the bytes it copies.
  for (const [actual, claimed] of [[64, 32], [31, 32], [0, 32], [33, 32]] as const) {
    const bytes = liar(actual, claimed);
    assert.equal(bytes.length, claimed);
    assert.equal(BaseDigest.fromBytesOrNull(bytes), null);
    assert.equal(SecretKey.ofOrNull(bytes), null);
    assert.equal(Fingerprint.fromBytesOrNull(bytes, "keyed"), null);
    assert.equal(HhImage.ofRgbaOrNull(4, 2, bytes), null);
  }
  for (const honest of [liar(32, 5), liar(32, 64), thrower(32)]) {
    const plain = new Uint8Array(32).fill(7);
    assert.equal(toHex((BaseDigest.fromBytes(honest) as BaseDigest).toBytes()), toHex(plain));
    assert.equal(toHex((Fingerprint.fromBytes(honest, "keyed") as Fingerprint).toBytes()), toHex(plain));
    assert.equal(toHex(SecretKey.of(honest).checkValue), toHex(SecretKey.of(plain).checkValue));
    assert.deepEqual(HhImage.ofRgba(4, 2, honest).rgba, plain);
  }
  // An input is hashed as the bytes it holds.
  const three = BaseDigest.of(new Uint8Array(3).fill(7));
  assert.ok(BaseDigest.of(liar(3, 2)).equals(three));
  assert.ok(BaseDigest.of(liar(3, 1048577)).equals(three));
  assert.ok(BaseDigest.of(thrower(3)).equals(three));
  assert.ok(BaseDigest.ofUtf8(liar(3, 0)).equals(BaseDigest.ofUtf8(new Uint8Array(3).fill(7))));
  assert.equal(BaseDigest.ofOrNull(liar(0, 3)), null);
  assert.equal(BaseDigest.ofOrNull(liar(1048577, 3)), null);
});

test("every entry point is total over hostile values", () => {
  const values: unknown[] = [
    undefined, null, true, 0, -1, 1.5, 16, 32, 128, Number.NaN, Number.POSITIVE_INFINITY, 2 ** 53, 10n, "", "00", "0x",
    "keyed", "square", "\ud800", Symbol("s"), {}, [], [0, 1], () => 0, new Uint8Array(0), new Uint8Array(32),
    new Uint8Array(32).fill(9),
    new Uint8Array(64), new Int8Array(32), new Uint8ClampedArray(32), new Float64Array(4), new ArrayBuffer(32),
    new DataView(new ArrayBuffer(32)), { length: 32 }, { shape: "round" }, { frame: "gaps", shape: "round" },
    { backgroundAlpha: 0 }, Object.create(null), new Proxy({}, {}), BaseDigest.fromBytes(new Uint8Array(32)),
    SecretKey.of(new Uint8Array(32).fill(1)), Fingerprint.fromBytes(new Uint8Array(32), "keyed"),
    spoof(32), liar(64, 32), liar(32, 64), thrower(32), new Proxy(new Uint8Array(32), {}), { backgroundRGB: 0 },
    Object.create(BaseDigest.prototype), Object.create(SecretKey.prototype), Object.create(Fingerprint.prototype),
    Object.create(Uint8Array.prototype),
  ];
  const any = <T>(v: unknown): T => v as T;
  const fp = Fingerprint.fromBytes(new Uint8Array(32).fill(0x55), "keyed");
  const image = fp.render(16);
  const calls: ((a: unknown, b: unknown) => unknown)[] = [
    (a) => BaseDigest.ofHex(any(a)),
    (a) => BaseDigest.ofText(any(a)),
    (a) => BaseDigest.fromBytes(any(a)),
    (a) => SecretKey.of(any(a)),
    (a) => Fingerprint.universal(any(a)),
    (a, b) => Fingerprint.keyed(any(a), any(b)),
    (a, b) => Fingerprint.fromBytes(any(a), any(b)),
    (a, b) => fp.render(any(a), any(b)),
    (a, b) => measureContrast(any(a), any(b)),
    (a, b) => HhImage.ofRgba(any(a), any(a), any(b)),
    (a, b) => HhImage.ofRgba(1, any(a), any(b)),
    (a) => image.encodeBmp(any(a)),
    (a, b) => image.encodeJpeg(any(a), any(b)),
    (a) => BaseDigest.fromBytes(new Uint8Array(32)).equals(a),
    (a) => fp.equals(a),
  ];
  let results = 0;
  for (const call of calls) {
    for (const a of values) {
      // A call that takes one argument is tried once per value, not once per pair.
      for (const b of call.length > 1 ? values : [undefined]) {
        try {
          call(a, b);
          results++;
        } catch (e) {
          assert.ok(e instanceof HhError, `${String(call)} threw ${String(e)}`);
        }
      }
    }
  }
  assert.ok(results > 0);
  // The slow entry points, once per value: a wrong type must fail before any work is done.
  for (const a of values) {
    for (const call of [BaseDigest.ofOrNull, BaseDigest.ofUtf8OrNull]) {
      const digest = call(any(a));
      assert.ok(digest === null || (a instanceof Uint8Array && new Uint8Array(a).length > 0));
    }
  }
});

test("encoders take any image", () => {
  const random = new Lcg(77);
  for (let i = 0; i < 60; i++) {
    const width = 1 + random.nextInt(40);
    const height = 1 + random.nextInt(40);
    const image = HhImage.ofRgba(width, height, random.nextBytes(width * height * 4));
    const matte = random.nextInt(0x1000000);
    assert.equal(image.encodeBmp(matte).length, 54 + Math.ceil((3 * width) / 4) * 4 * height);
    assert.ok(image.encodePng().length > 57);
    const jpeg = image.encodeJpeg(50 + random.nextInt(51), matte);
    assert.deepEqual([...jpeg.subarray(0, 2), ...jpeg.subarray(-2)], [0xff, 0xd8, 0xff, 0xd9]);
  }
});

test("the largest image encodes", () => {
  const image = HhImage.ofRgba(4096, 1, new Uint8Array(4096 * 4).fill(0xff));
  assert.equal(image.encodeBmp().length, 54 + 4096 * 3);
  assert.ok(image.encodePng().length < 200);
  assert.ok(image.encodeJpeg().length > 600);
});
