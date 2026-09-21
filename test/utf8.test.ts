import assert from "node:assert/strict";
import { test } from "node:test";

import { encodeUtf8, measureUtf8 } from "../src/utf8.js";
import { Lcg, toHex } from "./util.js";

const platform = new TextEncoder();

/** encodeURIComponent throws a URIError for an unpaired surrogate and for nothing else. */
function wellFormed(text: string): boolean {
  try {
    encodeURIComponent(text);
    return true;
  } catch {
    return false;
  }
}

function check(text: string): void {
  const measure = measureUtf8(text);
  const name = JSON.stringify(text);
  assert.equal(measure.wellFormed, wellFormed(text), name);
  // The platform encoder replaces an unpaired surrogate by U+FFFD, which is three bytes as well.
  assert.equal(measure.length, platform.encode(text).length, name);
  if (measure.wellFormed) {
    assert.equal(toHex(encodeUtf8(text, measure.length)), toHex(platform.encode(text)), name);
  }
}

test("the boundaries of the one-, two-, three- and four-byte forms", () => {
  const points = [0, 1, 0x7f, 0x80, 0x7ff, 0x800, 0xd7ff, 0xe000, 0xfeff, 0xfffd, 0xffff, 0x10000, 0x10348, 0x10ffff];
  for (const point of points) {
    check(String.fromCodePoint(point));
    check(`a${String.fromCodePoint(point)}z`);
  }
  assert.equal(toHex(encodeUtf8("caf\u00e9 \u20ac \u{10348}", 14)), "636166c3a920e282ac20f0908d88");
});

test("a byte order mark and a NUL are characters like any other", () => {
  assert.equal(toHex(encodeUtf8("\ufeffa\u0000", 5)), "efbbbf6100");
});

test("unpaired surrogates are reported, pairs are not", () => {
  const unpaired = [
    "\ud800", "\udc00", "\udfff", "\udbff", "a\ud800", "\ud800a", "\udc00\ud800", "\ud800\ud800\udc00",
    "\ud800\udc00\udc00",
  ];
  for (const text of unpaired) {
    assert.equal(measureUtf8(text).wellFormed, false, JSON.stringify(text));
    check(text);
  }
  for (const text of ["\ud800\udc00", "\udbff\udfff", "x\ud83d\ude00y", ""]) {
    assert.equal(measureUtf8(text).wellFormed, true, JSON.stringify(text));
    check(text);
  }
});

test("pseudo-random strings of code units agree with the platform", () => {
  const random = new Lcg(16);
  const unit = (): number => {
    switch (random.nextInt(6)) {
      case 0:
        return random.nextInt(0x80);
      case 1:
        return 0x80 + random.nextInt(0x780);
      case 2:
        return 0xd800 + random.nextInt(0x400);
      case 3:
        return 0xdc00 + random.nextInt(0x400);
      default:
        return random.nextInt(0x10000);
    }
  };
  for (let i = 0; i < 3000; i++) {
    const units = Array.from({ length: random.nextInt(12) }, unit);
    check(String.fromCharCode(...units));
  }
});
