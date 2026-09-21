import assert from "node:assert/strict";
import { test } from "node:test";

import { Sha256, compress, initialState, storeState } from "../src/sha256.js";
import { Lcg, ascii, repeatByte, sha256Hex, toHex } from "./util.js";

const hashHex = (message: Uint8Array): string => toHex(Sha256.digest(message));

// FIPS 180-4 and the NIST example values for SHA-256.
test("FIPS 180-4: the one-block message", () => {
  assert.equal(hashHex(ascii("abc")), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
});

test("FIPS 180-4: the two-block message", () => {
  assert.equal(
    hashHex(ascii("abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq")),
    "248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1",
  );
});

test("the 896-bit message", () => {
  const message =
    "abcdefghbcdefghicdefghijdefghijkefghijklfghijklmghijklmnhijklmnoijklmnopjklmnopqklmnopqrlmnopqrs" +
    "mnopqrstnopqrstu";
  assert.equal(hashHex(ascii(message)), "cf5b16a778af8380036ce59e7b0492370b249b11e8f07a51afac45037afee9d1");
});

test("the empty message", () => {
  assert.equal(hashHex(new Uint8Array(0)), "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
});

test("one million repetitions of 'a', absorbed in uneven pieces", () => {
  const hasher = new Sha256();
  const piece = repeatByte(0x61, 1000);
  for (let absorbed = 0; absorbed < 1000000; ) {
    const take = Math.min(1 + (absorbed % 997), 1000000 - absorbed);
    hasher.update(piece.subarray(0, take));
    absorbed += take;
  }
  assert.equal(toHex(hasher.finish()), "cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0");
});

test("every length around the block boundaries agrees with the platform", () => {
  for (let length = 0; length <= 260; length++) {
    const message = repeatByte(0x61, length);
    assert.equal(hashHex(message), sha256Hex(message), `length ${length}`);
  }
});

test("incremental updates give the one-shot digest", () => {
  const random = new Lcg(7);
  const message = random.nextBytes(1500);
  const expected = sha256Hex(message);
  assert.equal(hashHex(message), expected);
  for (let step = 1; step <= 130; step++) {
    const hasher = new Sha256();
    for (let at = 0; at < message.length; at += step) {
      hasher.update(message.subarray(at, Math.min(at + step, message.length)));
    }
    assert.equal(toHex(hasher.finish()), expected, `step ${step}`);
  }
});

test("pseudo-random messages agree with the platform", () => {
  const random = new Lcg(1);
  for (let i = 0; i < 300; i++) {
    const message = random.nextBytes(random.nextInt(5000));
    assert.equal(hashHex(message), sha256Hex(message), `message ${i}`);
  }
});

test("the bit length is right beyond 2^29 bytes, where its high word begins", () => {
  // A hasher that resumes after 2^29 bytes and absorbs 5 more pads with the bit length 2^32 + 40. The
  // expected digest is one compression of that padded block, built here by the rule of FIPS 180-4
  // section 5.1.1.
  const hasher = new Sha256(initialState(), 0x20000000);
  hasher.update(ascii("tail!"));
  const block = new Uint8Array(64);
  block.set(ascii("tail!"));
  block[5] = 0x80;
  block[59] = 0x01;
  block[63] = 40;
  const w = new Int32Array(64);
  const view = new DataView(block.buffer);
  for (let i = 0; i < 16; i++) {
    w[i] = view.getInt32(4 * i);
  }
  const state = initialState();
  compress(state, w);
  const expected = new Uint8Array(32);
  storeState(state, expected, 0);
  assert.equal(toHex(hasher.finish()), toHex(expected));
});

test("wipe clears the state, the buffered input and the schedule", () => {
  const hasher = new Sha256();
  hasher.update(ascii("secret"));
  hasher.wipe();
  const internals = hasher as unknown as { state: Int32Array; buffer: Uint8Array; schedule: Int32Array };
  assert.ok(internals.state.every((word) => word === 0));
  assert.ok(internals.buffer.every((byte) => byte === 0));
  assert.ok(internals.schedule.every((word) => word === 0));
});
