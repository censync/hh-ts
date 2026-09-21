// Reproduces every record of testdata/vectors.tsv, the golden vectors of hh-cpp (section 15 of the
// specification), and the golden PNG files. The files are a byte-identical copy; a mismatch is a bug in
// this implementation, never in the vectors.

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { KIND_BINARY, KIND_TEXT, d0, m1Header, m2 } from "../src/derive.js";
import { BaseDigest, FIGURES, Fingerprint, HhError, HhImage, SecretKey, measureContrast } from "../src/index.js";
import type { FrameStyle, Mode, RenderOptions, Shape } from "../src/index.js";
import { TESTDATA, fromHex, pattern, sha256Hex, toHex } from "./util.js";

const RECORDS: readonly (readonly string[])[] = readFileSync(join(TESTDATA, "vectors.tsv"), "utf8")
  .split("\n")
  .filter((line) => line !== "" && !line.startsWith("#"))
  .map((line) => line.split("\t"));

function records(type: string): readonly (readonly string[])[] {
  return RECORDS.filter((r) => r[0] === type);
}

/** The field `i` of a record. */
function field(r: readonly string[], i: number): string {
  const value = r[i];
  assert.notEqual(value, undefined, `${r[1]}: the record has no field ${i}`);
  return value as string;
}

/** `hex:<bytes>` or `fill:<byte>:<count>`. */
function input(text: string): Uint8Array<ArrayBuffer> {
  if (text.startsWith("hex:")) {
    return fromHex(text.slice(4));
  }
  const [, byte, count] = text.split(":");
  return new Uint8Array(Number(count)).fill(Number.parseInt(byte as string, 16));
}

function digestOf(kind: string, data: Uint8Array): BaseDigest {
  if (kind === "text") {
    return BaseDigest.ofText(new TextDecoder("utf-8", { fatal: true }).decode(data));
  }
  return BaseDigest.of(data);
}

function cellsText(fp: Fingerprint): string {
  return fp
    .layout()
    .cells.map((cell) => `${FIGURES.indexOf(cell.figure)}${cell.colour}`)
    .join("");
}

/** The name of the error that `block` throws. */
function errorOf(block: () => unknown): string {
  try {
    block();
  } catch (e) {
    assert.ok(e instanceof HhError, `not an HhError: ${String(e)}`);
    return e.specName;
  }
  return "ok";
}

interface RenderCase {
  readonly fp: Fingerprint;
  readonly size: number;
  readonly options: RenderOptions;
}

/** The fields fp, mode, size, shape, frame, background, frame alpha starting at `at`. */
function renderCase(r: readonly string[], at: number): RenderCase {
  const background = field(r, at + 5);
  return {
    fp: Fingerprint.fromBytes(fromHex(field(r, at)), field(r, at + 1) as Mode),
    size: Number(field(r, at + 2)),
    options: {
      shape: field(r, at + 3) as Shape,
      frame: field(r, at + 4) as FrameStyle,
      backgroundRgb: Number.parseInt(background.slice(0, 6), 16),
      backgroundAlpha: Number.parseInt(background.slice(6), 16),
      frameAlpha: Number(field(r, at + 6)),
    },
  };
}

test("the file is present and complete", () => {
  const atLeast: Readonly<Record<string, number>> = {
    D: 20, H: 20, K: 8, C: 20, R: 80, E: 25, G: 20, W: 15, I: 14, F: 16,
  };
  for (const [type, count] of Object.entries(atLeast)) {
    assert.ok(records(type).length >= count, `${type}: ${records(type).length} records`);
  }
  assert.deepEqual([...new Set(RECORDS.map((r) => r[0]))].sort(), Object.keys(atLeast).sort());
});

// testdata/SOURCE names the hh-cpp release the files came from and their SHA-256.
test("the copy is what SOURCE records", () => {
  const lines = readFileSync(join(TESTDATA, "SOURCE"), "utf8").split("\n");
  // The vectors come from a release of hh-cpp, never from an untagged commit.
  assert.ok(lines.some((line) => /^tag: v\d+\.\d+\.\d+$/.test(line)), "testdata/SOURCE names no release tag");
  assert.ok(lines.some((line) => /^commit: [0-9a-f]{40}$/.test(line)), "testdata/SOURCE names no commit");
  const hashes = lines.filter((line) => /^[0-9a-f]{64} {2}\S+$/.test(line)).map((line) => line.split("  "));
  assert.equal(hashes.length, 1 + records("G").length);
  for (const [hash, name] of hashes) {
    assert.equal(sha256Hex(readFileSync(join(TESTDATA, name as string))), hash, name);
  }
});

test("D: derivation records", () => {
  for (const r of records("D")) {
    const id = field(r, 1);
    assert.equal(r.length, 16, id);
    const kind = field(r, 2);
    const data = input(field(r, 3));
    const kindByte = kind === "text" ? KIND_TEXT : KIND_BINARY;
    if (field(r, 5) !== "-") {
      assert.equal(toHex(m1Header(kindByte, data.length)) + toHex(data), field(r, 5), `${id} M1`);
      assert.equal(sha256Hex(fromHex(field(r, 5))), field(r, 6), `${id} SHA-256(M1)`);
    }
    assert.equal(toHex(d0(kindByte, data)), field(r, 6), `${id} d0`);
    const digest = digestOf(kind, data);
    assert.equal(toHex(digest.toBytes()), field(r, 7), `${id} s`);
    if (kind === "text") {
      assert.ok(BaseDigest.ofUtf8(data).equals(digest), `${id} ofUtf8`);
    }
    assert.equal(toHex(m2(digest.toBytes())), field(r, 8), `${id} M2`);
    const universal = Fingerprint.universal(digest);
    assert.equal(universal.mode, "universal", id);
    assert.equal(toHex(universal.toBytes()), field(r, 9), `${id} universal fp`);
    assert.equal(cellsText(universal), field(r, 12), `${id} universal cells`);
    assert.equal(universal.tag, field(r, 14), `${id} universal tag`);
    if (field(r, 4) === "-") {
      assert.deepEqual([r[10], r[11], r[13], r[15]], ["-", "-", "-", "-"], id);
      continue;
    }
    const key = SecretKey.of(fromHex(field(r, 4)));
    try {
      assert.equal(toHex(key.checkValue), field(r, 11), `${id} KCV`);
      const keyed = Fingerprint.keyed(digest, key);
      assert.equal(keyed.mode, "keyed", id);
      assert.equal(toHex(keyed.toBytes()), field(r, 10), `${id} keyed fp`);
      assert.equal(cellsText(keyed), field(r, 13), `${id} keyed cells`);
      assert.equal(keyed.tag, field(r, 15), `${id} keyed tag`);
    } finally {
      key.close();
    }
  }
});

test("H: hexadecimal input records", () => {
  for (const r of records("H")) {
    const id = field(r, 1);
    const text = new TextDecoder().decode(fromHex(field(r, 2)));
    const expected = field(r, 3);
    if (/^[0-9a-f]+$/.test(expected)) {
      assert.ok(BaseDigest.ofHex(text).equals(BaseDigest.of(fromHex(expected))), id);
    } else {
      assert.equal(errorOf(() => BaseDigest.ofHex(text)), expected, id);
      assert.equal(BaseDigest.ofHexOrNull(text), null, id);
    }
  }
});

test("K: key records", () => {
  for (const r of records("K")) {
    const id = field(r, 1);
    const raw = field(r, 2) === "-" ? new Uint8Array(0) : fromHex(field(r, 2));
    const key = SecretKey.ofOrNull(raw);
    if (key !== null) {
      assert.equal(toHex(key.checkValue), field(r, 3), id);
      key.close();
    } else {
      assert.equal(errorOf(() => SecretKey.of(raw)), field(r, 3), id);
    }
  }
});

test("C: contrast records", () => {
  for (const r of records("C")) {
    const background = field(r, 2);
    const options: RenderOptions = {
      backgroundRgb: Number.parseInt(background.slice(0, 6), 16),
      backgroundAlpha: Number.parseInt(background.slice(6), 16),
      frameAlpha: Number(field(r, 3)),
    };
    const report = measureContrast(options, Number.parseInt(field(r, 4), 16));
    assert.deepEqual(report, { figuresX100: Number(field(r, 5)), frameX100: Number(field(r, 6)) }, field(r, 1));
  }
});

test("R: render records", () => {
  for (const r of records("R")) {
    const id = field(r, 1);
    assert.equal(r.length, 15, id);
    const c = renderCase(r, 2);
    const image = c.fp.render(c.size, c.options);
    const matte = Number.parseInt(field(r, 10), 16);
    assert.equal(sha256Hex(image.rgba), field(r, 11), `${id} rgba`);
    assert.equal(sha256Hex(image.encodePng()), field(r, 12), `${id} png`);
    assert.equal(sha256Hex(image.encodeBmp(matte)), field(r, 13), `${id} bmp`);
    assert.equal(sha256Hex(image.encodeJpeg(Number(field(r, 9)), matte)), field(r, 14), `${id} jpeg`);
  }
});

test("E: render error records", () => {
  for (const r of records("E")) {
    const c = renderCase(r, 2);
    assert.equal(errorOf(() => c.fp.render(c.size, c.options)), field(r, 9), field(r, 1));
    assert.equal(c.fp.renderOrNull(c.size, c.options), null, field(r, 1));
  }
});

test("G: golden files", () => {
  for (const r of records("G")) {
    const c = renderCase(r, 3);
    const expected = readFileSync(join(TESTDATA, "golden", field(r, 2)));
    const png = c.fp.render(c.size, c.options).encodePng();
    assert.ok(Buffer.from(png).equals(expected), field(r, 2));
  }
});

test("W: size sweep records", () => {
  for (const r of records("W")) {
    const id = field(r, 1);
    assert.equal(r.length, 11, id);
    // fp, mode, shape, frame, background, frame alpha, first size, last size: the size moves to its usual place.
    const c = renderCase([2, 3, 8, 4, 5, 6, 7].map((i) => field(r, i)), 0);
    const hash = createHash("sha256");
    for (let size = c.size; size <= Number(field(r, 9)); size++) {
      hash.update(c.fp.render(size, c.options).rgba);
    }
    assert.equal(hash.digest("hex"), field(r, 10), id);
  }
});

test("I: image records", () => {
  for (const r of records("I")) {
    const id = field(r, 1);
    assert.equal(r.length, 11, id);
    const width = Number(field(r, 2));
    const height = Number(field(r, 3));
    const image = HhImage.ofRgba(width, height, pattern(field(r, 4), width, height));
    const matte = Number.parseInt(field(r, 6), 16);
    assert.equal(sha256Hex(image.rgba), field(r, 7), `${id} rgba`);
    assert.equal(sha256Hex(image.encodePng()), field(r, 8), `${id} png`);
    assert.equal(sha256Hex(image.encodeBmp(matte)), field(r, 9), `${id} bmp`);
    assert.equal(sha256Hex(image.encodeJpeg(Number(field(r, 5)), matte)), field(r, 10), `${id} jpeg`);
  }
});

test("F: failure records", () => {
  for (const r of records("F")) {
    const id = field(r, 1);
    const expected = field(r, r.length - 1);
    switch (field(r, 2)) {
      case "digest": {
        const data = input(field(r, 4));
        assert.equal(errorOf(() => digestOf(field(r, 3), data)), expected, id);
        if (field(r, 3) === "text") {
          assert.equal(errorOf(() => BaseDigest.ofUtf8(data)), expected, `${id} ofUtf8`);
        }
        break;
      }
      case "jpeg": {
        const image = HhImage.ofRgba(8, 8, pattern("flat:ffffffff", 8, 8));
        assert.equal(errorOf(() => image.encodeJpeg(Number(field(r, 3)))), expected, id);
        break;
      }
      case "image": {
        const rgba = new Uint8Array(Number(field(r, 5))).fill(0x7f);
        assert.equal(errorOf(() => HhImage.ofRgba(Number(field(r, 3)), Number(field(r, 4)), rgba)), expected, id);
        assert.equal(HhImage.ofRgbaOrNull(Number(field(r, 3)), Number(field(r, 4)), rgba), null, id);
        break;
      }
      default:
        assert.fail(`${id}: unknown operation ${field(r, 2)}`);
    }
  }
});
