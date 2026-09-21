# Contributing to hh-ts

hh-ts is the TypeScript implementation of Humanized Hash (`hh`). The C++17 repository hh-cpp is
the reference: it owns `docs/SPEC.md`, `docs/SECURITY.md` and the canonical golden vectors. This
repository carries a byte-identical copy of the vectors in `testdata/` and records the hh-cpp
release and the file hashes in `testdata/SOURCE`. The implementation follows `SPEC.md`, not the
C++ source.

Bug reports and patches are welcome: open an issue or a pull request. Security problems are
reported privately, as `docs/SECURITY.md` of hh-cpp describes.

## The algorithm is frozen

Output is byte-identical with hh-cpp. A mismatch against the vectors is a bug here, never a reason
to change the vectors. The algorithm has no version and never changes; what the specification
leaves open (API shape, error texts, performance) may evolve under SemVer.

hh is a standalone library. Nothing here names a particular host application.

## Dependencies and license

- The published package has no dependencies: `package.json` has no `dependencies`,
  `peerDependencies` or `optionalDependencies`, and a test keeps it that way.
- The library in `src/` uses no platform API: no Node.js modules, no DOM, no `TextEncoder`, no
  WebCrypto. `tsconfig.json` compiles it with `"lib": ["ES2020"]` and `"types": []`, so such code
  does not compile. SHA-256, HMAC, PBKDF2, UTF-8, CRC-32, Adler-32, deflate and the PNG, BMP and
  JPEG encoders are written here.
- The toolchain is `typescript` and `@types/node`, pinned to exact versions, with
  `package-lock.json` committed. Nothing else: no test framework, no bundler, no linter, no
  formatter. `@types/node` stays at the oldest supported Node.js line, so that a newer API does
  not compile.
- Tests, `cli/` and `bench/` are Node.js programs. They use `node:test`, `node:assert/strict` and
  other built-in modules, and may cross-check against `node:crypto` and `node:zlib`.
- License: MIT (`LICENSE`); contributions are accepted under it.

## Style

- Everything is English: code, comments, TSDoc, documentation, commit messages. No emoji.
- Two spaces, 120 columns, double quotes, semicolons, trailing commas in multi-line lists
  (`.editorconfig`). `camelCase` for functions and values, `PascalCase` for types and classes,
  `UPPER_CASE` for module constants, `kebab-case` file names. Import specifiers carry the `.js`
  extension, so that the compiled output runs as it is.
- Strict compiler settings (`tsconfig.base.json`), zero diagnostics. No `any`, no non-null
  assertions in `src/`.
- TSDoc on every export, internal ones included. Comments explain the code and cite the section of
  the specification or the standard they implement.

## Library rules (src/)

- Integer arithmetic only. A JavaScript number is a double, so the rule is: every value is an
  integer, and every intermediate result stays below 2^53; 32-bit work uses `| 0`, `>>> 0` and
  `Math.imul`. A division drops its fraction at once, `(a / b) | 0`, or goes through `floorDiv`;
  `src/int.ts` holds the proof that this is exact. No floating-point literals, no `Math` beyond
  `imul`, `min`, `max` and `abs`. `test/sources.test.ts` checks these rules. Tests, `cli/` and
  `bench/` may use floating point to measure error and to report.
- Every entry point is total: any value, of any type, gives a result or an `HhError`. The
  `...OrNull` variants return `null` instead of throwing. Bytes are recognised by the brand of a
  typed array, not by `instanceof` or `Symbol.toStringTag`, and objects of the library by their
  private fields; what is taken in is copied first and checked as the copy.
- Objects of the public API keep their state in `#` private fields and are frozen; exported lists
  and tables are frozen, and validation does not read them. The compiler lowers the private names
  for the ES2020 target; a test keeps newer syntax out of `dist/`.
- No clock, no random numbers, no mutable module state, no I/O.
- Buffers that held key material are wiped before release, as far as JavaScript allows; the
  TSDoc of `SecretKey` states the limit.

## Build and test

- `npm ci`, then `npm test`: compiles the library (`dist/`), then the library again together with
  the tests, the command line tool and the benchmark (`build/`), and runs every test file. A new
  test file has to be added to the `test` script in `package.json`; globs are avoided because
  Node.js 20 and Windows do not expand them. A test checks that the list is complete.
- `tools/crosscheck.sh <hh_cli>` runs the differential test against hh-cpp: generated cases, then
  the hand-made cases of `tools/edge-cases.txt`. That file is bytes, the same in every
  implementation of hh, and the head of `examples/hh_cli.cpp` in hh-cpp defines the format;
  `cli/hh-cli.ts` follows it to the letter.
- `tools/update-vectors.sh <hh-cpp checkout>` refreshes `testdata/` and `testdata/SOURCE`; never
  edit those files by hand.
- `npm pack --dry-run` shows what would be published: `dist/`, `README.md`, `LICENSE`,
  `CHANGELOG.md` and `package.json`.
- Supported: Node.js 20, 22 and 24. Code and tests use nothing newer than Node.js 20.

## Commits

Atomic, imperative, lower case, for example "add sha-256 with fips 180-4 vectors". Every commit
builds and passes the tests.
