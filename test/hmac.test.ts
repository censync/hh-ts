import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { test } from "node:test";

import { HmacSha256 } from "../src/hmac.js";
import { Lcg, ascii, fromHex, repeatByte, toHex } from "./util.js";

const tagHex = (key: Uint8Array, data: Uint8Array): string => toHex(HmacSha256.tag(key, data));

// RFC 4231 section 4, HMAC-SHA-256 results of test cases 1 to 7.
const RFC_4231: readonly (readonly [name: string, key: Uint8Array, data: Uint8Array, tag: string])[] = [
  [
    "case 1",
    repeatByte(0x0b, 20),
    ascii("Hi There"),
    "b0344c61d8db38535ca8afceaf0bf12b881dc200c9833da726e9376c2e32cff7",
  ],
  [
    "case 2: a key shorter than the output",
    ascii("Jefe"),
    ascii("what do ya want for nothing?"),
    "5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843",
  ],
  [
    "case 3: combined length above the block size",
    repeatByte(0xaa, 20),
    repeatByte(0xdd, 50),
    "773ea91e36800e46854db8ebd09181a72959098b3ef8c122d9635514ced565fe",
  ],
  [
    "case 4: combined length above the block size",
    fromHex("0102030405060708090a0b0c0d0e0f10111213141516171819"),
    repeatByte(0xcd, 50),
    "82558a389a443c0ea4cc819899f2083a85f0faa3e578f8077a2e3ff46729665b",
  ],
  [
    "case 5: truncation to 128 bits",
    repeatByte(0x0c, 20),
    ascii("Test With Truncation"),
    "a3b6167473100ee06e0c796c2955552b",
  ],
  [
    "case 6: a key larger than the block size",
    repeatByte(0xaa, 131),
    ascii("Test Using Larger Than Block-Size Key - Hash Key First"),
    "60e431591ee0b67f0d8a26aacbf5b77f8e0bc6213728c5140546040f0ee37f54",
  ],
  [
    "case 7: a key and data larger than the block size",
    repeatByte(0xaa, 131),
    ascii(
      "This is a test using a larger than block-size key and a larger than block-size data. " +
        "The key needs to be hashed before being used by the HMAC algorithm.",
    ),
    "9b09ffa71b942fcb27635fbcd5b0e944bfdc63644f0713938a7f51535c3a35e2",
  ],
];

for (const [name, key, data, tag] of RFC_4231) {
  test(`RFC 4231 ${name}`, () => {
    assert.equal(tagHex(key, data).slice(0, tag.length), tag);
  });
}

test("key lengths at the block boundary agree with the platform", () => {
  const data = ascii("boundary");
  for (const length of [0, 1, 31, 32, 33, 63, 64, 65, 127, 128, 129]) {
    const key = repeatByte(0x5a, length);
    assert.equal(tagHex(key, data), createHmac("sha256", key).update(data).digest("hex"), `key of ${length}`);
  }
});

// RFC 2104 zero-pads short keys: K and K || 00 are the same key, and the empty key equals 32 zero bytes.
test("zero padding makes trailing zero bytes irrelevant", () => {
  const data = ascii("padding");
  assert.equal(tagHex(fromHex("01020300"), data), tagHex(fromHex("010203"), data));
  assert.equal(tagHex(new Uint8Array(0), data), tagHex(new Uint8Array(32), data));
});

test("a message given in parts gives the tag of the whole", () => {
  const random = new Lcg(3);
  const key = random.nextBytes(32);
  const message = random.nextBytes(300);
  const mac = new HmacSha256(key);
  const whole = toHex(mac.tag(message));
  for (const cut of [0, 1, 63, 64, 65, 299, 300]) {
    assert.equal(toHex(mac.tag(message.subarray(0, cut), message.subarray(cut))), whole, `cut at ${cut}`);
  }
  assert.equal(whole, tagHex(key, message));
});

test("pseudo-random keys and messages agree with the platform", () => {
  const random = new Lcg(2);
  for (let i = 0; i < 200; i++) {
    const key = random.nextBytes(random.nextInt(200));
    const data = random.nextBytes(random.nextInt(500));
    assert.equal(tagHex(key, data), createHmac("sha256", key).update(data).digest("hex"), `case ${i}`);
  }
});

test("wipe clears the key-dependent states", () => {
  const mac = new HmacSha256(ascii("key"));
  mac.wipe();
  assert.deepEqual([...mac.innerState, ...mac.outerState], new Array(16).fill(0));
});
