// The package as it is published: what package.json promises, and the compiled entry point in dist/.

import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import * as source from "../src/index.js";
import { TESTDATA } from "./util.js";

const ROOT = new URL("../../", import.meta.url);
const manifest = JSON.parse(readFileSync(new URL("package.json", ROOT), "utf8")) as Record<string, unknown>;

test("the package has no dependencies and a pinned toolchain", () => {
  assert.equal(manifest["dependencies"], undefined);
  assert.equal(manifest["peerDependencies"], undefined);
  assert.equal(manifest["optionalDependencies"], undefined);
  const dev = manifest["devDependencies"] as Record<string, string>;
  assert.deepEqual(Object.keys(dev).sort(), ["@types/node", "typescript"]);
  for (const [name, version] of Object.entries(dev)) {
    assert.match(version, /^\d+\.\d+\.\d+$/, `${name} is not pinned to an exact version`);
  }
  // The lock file holds the toolchain and what it needs, nothing else.
  const lock = JSON.parse(readFileSync(new URL("package-lock.json", ROOT), "utf8")) as {
    packages: Record<string, unknown>;
  };
  assert.deepEqual(
    Object.keys(lock.packages).sort(),
    ["", "@types/node", "typescript", "undici-types"].map((name) => (name === "" ? "" : `node_modules/${name}`)),
  );
});

test("the manifest is that of an ESM-only library", () => {
  assert.equal(manifest["name"], "@censync/hh");
  assert.equal(manifest["version"], source.VERSION);
  assert.equal(manifest["type"], "module");
  assert.equal(manifest["sideEffects"], false);
  assert.equal(manifest["license"], "MIT");
  assert.deepEqual(manifest["files"], ["dist", "README.md", "LICENSE", "CHANGELOG.md"]);
  assert.deepEqual(manifest["exports"], {
    ".": { types: "./dist/index.d.ts", default: "./dist/index.js" },
    "./package.json": "./package.json",
  });
  for (const file of ["README.md", "LICENSE", "CHANGELOG.md", "dist/index.js", "dist/index.d.ts"]) {
    assert.ok(existsSync(new URL(file, ROOT)), file);
  }
  const changelog = readFileSync(new URL("CHANGELOG.md", ROOT), "utf8");
  assert.ok(changelog.includes(`\n## [${source.VERSION}] - `), "CHANGELOG.md has no entry for this version");
});

test("the test script runs every test file", () => {
  // Node.js 20 and the shell of Windows expand no globs, so package.json lists the files.
  const script = (manifest["scripts"] as Record<string, string>)["test"] as string;
  const listed = [...script.matchAll(/build\/test\/([a-z0-9-]+\.test)\.js/g)].map((match) => `${match[1]}.ts`);
  const present = readdirSync(new URL("test/", ROOT)).filter((name) => name.endsWith(".test.ts"));
  assert.deepEqual(listed.sort(), present.sort());
});

test("the compiled entry point exports the public API and renders a golden file", async () => {
  const dist = (await import(new URL("dist/index.js", ROOT).href)) as typeof source;
  assert.deepEqual(Object.keys(dist).sort(), Object.keys(source).sort());
  assert.deepEqual(Object.keys(dist).sort(), [
    "BaseDigest", "FIGURES", "FRAME_STYLES", "Fingerprint", "HhError", "HhErrorCode", "HhImage", "MODES", "SHAPES",
    "SecretKey", "VERSION", "measureContrast",
  ]);
  const fp = dist.Fingerprint.universal(dist.BaseDigest.ofHex("0x1234567890abcdef00112233445566778899aabb"));
  const golden = readFileSync(`${TESTDATA}golden/poison-a-universal-128.png`);
  assert.ok(golden.equals(fp.render(128).encodePng()));
});

test("the compiled library imports nothing but itself", () => {
  const dist = fileURLToPath(new URL("dist/", ROOT));
  const modules = readdirSync(dist).filter((name) => name.endsWith(".js"));
  assert.ok(modules.length >= 15);
  for (const name of modules) {
    const text = readFileSync(`${dist}${name}`, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    for (const [, specifier] of text.matchAll(/\b(?:from|import)\s*\(?\s*"([^"]+)"/g)) {
      assert.match(specifier as string, /^\.\/[a-z0-9-]+\.js$/, `${name} imports ${specifier}`);
    }
    assert.doesNotMatch(text, /\brequire\s*\(/, name);
  }
  // The internal declarations are stripped from the published types.
  assert.doesNotMatch(readFileSync(`${dist}image.d.ts`, "utf8"), /\bwrap\b/);
  assert.doesNotMatch(readFileSync(`${dist}secret-key.d.ts`, "utf8"), /keyedFingerprint/);
  assert.doesNotMatch(readFileSync(`${dist}base-digest.d.ts`, "utf8"), /bytesOf/);
});

test("the compiled library keeps to the syntax of ES2020", () => {
  // The sources use private names; the compiler must have lowered them, and nothing newer may slip in.
  const dist = fileURLToPath(new URL("dist/", ROOT));
  const newer = /(^|[^/\w"'`])#[A-Za-z_]|\bstatic\s*\{|\?\?=|\|\|=|&&=|\bObject\.hasOwn\b|\.at\(/m;
  for (const name of readdirSync(dist).filter((file) => file.endsWith(".js"))) {
    const text = readFileSync(`${dist}${name}`, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    assert.doesNotMatch(text, newer, name);
  }
  assert.match(readFileSync(`${dist}fingerprint.js`, "utf8"), /new WeakMap\(\)/);
});
