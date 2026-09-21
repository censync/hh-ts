import assert from "node:assert/strict";
import { pbkdf2Sync } from "node:crypto";
import { test } from "node:test";

import { pbkdf2HmacSha256 } from "../src/pbkdf2.js";
import { Lcg, ascii, toHex } from "./util.js";

const deriveHex = (password: string, salt: string, iterations: number, length: number): string =>
  toHex(pbkdf2HmacSha256(ascii(password), ascii(salt), iterations, length));

// RFC 7914 section 11, the two PBKDF2-HMAC-SHA-256 test vectors.
test("RFC 7914: one iteration", () => {
  assert.equal(
    deriveHex("passwd", "salt", 1, 64),
    "55ac046e56e3089fec1691c22544b605f94185216dde0465e68b9d57c20dacbc" +
      "49ca9cccf179b645991664b39d77ef317c71b845b1e30bd509112041d3a19783",
  );
});

test("RFC 7914: eighty thousand iterations", () => {
  assert.equal(
    deriveHex("Password", "NaCl", 80000, 64),
    "4ddcd8f60b98be21830cee5ef22701f9641a4418d04c0414aeff08876b34ab56" +
      "a1d425a1225833549adb841b51c9b3176a272bdebba1d078478f62b397f33c8d",
  );
});

test("single-block, truncated and empty outputs", () => {
  const full = deriveHex("password", "salt", 2, 32);
  assert.equal(full, pbkdf2Sync("password", "salt", 2, 32, "sha256").toString("hex"));
  assert.equal(deriveHex("password", "salt", 2, 20), full.slice(0, 40));
  assert.equal(deriveHex("password", "salt", 2, 0), "");
});

test("the output prefix does not depend on the output length", () => {
  const long = deriveHex("password", "salt", 3, 100);
  for (const length of [1, 31, 32, 33, 64, 65, 99]) {
    assert.equal(deriveHex("password", "salt", 3, length), long.slice(0, 2 * length), `length ${length}`);
  }
});

test("pseudo-random parameters agree with the platform", () => {
  const random = new Lcg(4);
  for (let i = 0; i < 60; i++) {
    const password = random.nextBytes(random.nextInt(100));
    const salt = random.nextBytes(random.nextInt(100));
    const iterations = 1 + random.nextInt(40);
    const length = random.nextInt(100);
    assert.equal(
      toHex(pbkdf2HmacSha256(password, salt, iterations, length)),
      pbkdf2Sync(password, salt, iterations, length, "sha256").toString("hex"),
      `case ${i}`,
    );
  }
});

test("the stretching parameters of the specification agree with the platform", () => {
  const d0 = new Lcg(5).nextBytes(32);
  const salt = ascii("HumanizedHash/stretch");
  assert.equal(
    toHex(pbkdf2HmacSha256(d0, salt, 16384, 32)),
    pbkdf2Sync(d0, salt, 16384, 32, "sha256").toString("hex"),
  );
});
