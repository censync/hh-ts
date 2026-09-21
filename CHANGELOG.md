# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html). Each release names the hh-cpp release
its golden vectors were copied from. The algorithm itself is frozen and has no version: no
release changes a fingerprint, a pixel or an encoded byte.

## [1.0.0] - 2026-09-21

The first release. Golden vectors: hh-cpp v1.0.0.

### Added

- Public API of `@censync/hh` (ESM, type declarations, TSDoc): `BaseDigest` from bytes,
  hexadecimal, text or UTF-8 bytes; `SecretKey`, wiped on `close()`, with `closed` and a key check
  value that stays readable after the key is closed; universal and keyed `Fingerprint` with
  layout and six-character tag; `RenderOptions` with square and round shapes, keyed-mode frame
  markers, any background colour and transparency, frame transparency, and `measureContrast`, a
  WCAG contrast measure; `HhImage` with RGBA pixels and PNG, BMP and JPEG encoders. `HhError`
  carries the numeric code (`code`) and the name (`specName`) of the error of the specification;
  `...OrNull` forms for hostile input.
- Every entry point is total over JavaScript values: bytes are recognised by the brand of a typed
  array and copied before they are measured, an options object with a property that is not an
  option is `invalid_argument`, and an image whose pixel buffer was detached is `invalid_image`
  in every encoder. Digests, fingerprints, keys and images are frozen; the bytes of the first
  three live in private fields and leave only as copies. The exported lists `MODES`, `SHAPES`,
  `FRAME_STYLES`, `FIGURES` and the `HhErrorCode` object are frozen.
- Internal SHA-256, HMAC-SHA-256, PBKDF2-HMAC-SHA-256, UTF-8 encoding, CRC-32, Adler-32,
  fixed-Huffman deflate and a baseline JPEG encoder, in integer arithmetic: the package has no
  dependencies and uses no platform API, which the compiler configuration enforces.
- Tests on the test runner of Node.js: known-answer tests of the primitives (FIPS 180-4, RFC 4231,
  RFC 7914) with cross-checks against `node:crypto`; the golden vectors of hh-cpp; the renderer
  against a per-sample implementation of the specification; decoding of every encoder's output
  (zlib for PNG, a baseline JPEG decoder written for the tests); error order; deterministic
  robustness loops; checks of the sources and of the package.
- `tools/crosscheck.sh` and `cli/hh-cli.ts`: differential test against `hh_cli` of hh-cpp, with
  generated cases and the hand-made cases of `tools/edge-cases.txt`, which every implementation
  carries. `tools/update-vectors.sh` copies the vectors and writes `testdata/SOURCE`.
- `bench/bench.ts`: timings of the base digest, the renderer and the encoders.

[1.0.0]: https://github.com/censync/hh-ts/releases/tag/v1.0.0
