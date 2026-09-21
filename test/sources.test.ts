// The library is integer-only and uses no clock, no random numbers and no platform API. The compiler keeps
// platform APIs out (tsconfig.json: "lib": ["ES2020"], "types": []); this test reads the sources for what
// the compiler cannot see.

import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const SRC = fileURLToPath(new URL("../../src/", import.meta.url));
const FILES = readdirSync(SRC).filter((name) => name.endsWith(".ts"));

/** A source file without its comments. */
function uncommented(name: string): string {
  return readFileSync(`${SRC}${name}`, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

/** The code of a source file: no comments and no contents of string literals. */
function code(name: string): string {
  return uncommented(name)
    .replace(/"(?:[^"\\\n]|\\.)*"/g, '""')
    .replace(/`(?:[^`\\]|\\.)*`/g, "``");
}

test("the sources are there", () => {
  assert.ok(FILES.length >= 15, `${FILES.length} files`);
  assert.ok(FILES.includes("index.ts"));
});

test("no floating-point literals and no floating-point functions", () => {
  // int.ts holds the one Math.floor of the library and the proof that goes with it.
  const allowed = new Set(["imul", "min", "max", "abs"]);
  for (const name of FILES) {
    const text = code(name);
    assert.doesNotMatch(text, /\b\d+\.\d|\b\d+e[+-]?\d/i, `${name}: a floating-point literal`);
    assert.doesNotMatch(text, /\*\*|parseFloat|toFixed|toPrecision|Number\.EPSILON|Float(32|64)Array/, name);
    for (const [, member] of text.matchAll(/\bMath\.(\w+)/g)) {
      assert.ok(allowed.has(member as string) || (member === "floor" && name === "int.ts"), `${name}: Math.${member}`);
    }
  }
});

test("every division drops its fraction at once or is the one of floorDiv", () => {
  for (const name of FILES) {
    for (const line of code(name).split("\n")) {
      if (!/[\w)\]]\s*\/\s*[\w(]/.test(line)) {
        continue;
      }
      const truncated = /\/[^/]*\) \| 0\b/.test(line);
      const proven = name === "int.ts" && line.includes("Math.floor(a / b)");
      assert.ok(truncated || proven, `${name}: ${line.trim()}`);
    }
  }
});

test("no clock, no random numbers, no platform objects, no dynamic code", () => {
  const names = [
    "Date", "performance", "crypto", "process", "Buffer", "require", "globalThis", "window", "self", "document",
    "navigator", "console", "TextEncoder", "TextDecoder", "setTimeout", "setInterval", "fetch", "eval", "Function",
    "WebAssembly", "Atomics", "SharedArrayBuffer",
  ];
  const forbidden = new RegExp(`\\b(${names.join("|")})\\b|Math\\.random|\\bimport\\s*\\(`);
  for (const name of FILES) {
    assert.doesNotMatch(code(name), forbidden, name);
  }
});

test("modules import only their neighbours, with the .js extension", () => {
  for (const name of FILES) {
    for (const [, specifier] of uncommented(name).matchAll(/\bfrom\s+"([^"]+)"/g)) {
      assert.match(specifier as string, /^\.\/[a-z0-9-]+\.js$/, `${name} imports ${specifier}`);
    }
  }
});
