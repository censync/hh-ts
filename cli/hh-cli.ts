// hh-cli: an address or hash in, a picture out; the counterpart of hh_cli in hh-cpp.
//
//   hh-cli 0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed --out address.png
//   hh-cli --text bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4 --size 256 --out address.png
//   hh-cli <hex> --key <64 hex digits> --shape round --frame double --out private.png
//   hh-cli --generate COUNT SEED      prints COUNT pseudo-random cases, valid and invalid ones
//   hh-cli --batch FILE DIR           runs the cases of FILE, writes case-<n>.<format> into DIR
//
// The batch format is that of hh_cli of hh-cpp, which defines it at the head of examples/hh_cli.cpp; both
// tools must print the same lines and write the same files:
//
//   - The file is bytes. Lines end with LF; one CR before it is dropped. A line that is then empty or
//     begins with '#' is skipped and not counted. Cases are numbered from 1.
//   - A case is exactly 11 fields separated by runs of ASCII spaces or tabs:
//       hex|text  input  key|-  size  shape  frame  background  frame-alpha  format  quality  matte
//   - size, frame-alpha and quality are 1 to 10 ASCII digits without a sign. A frame alpha above 255 is a
//     bad case; size and quality are clamped to 2 147 483 647, which is just as invalid, and go to the
//     library.
//   - For "text" the input is the hexadecimal form of the UTF-8 bytes, which reach the library verbatim;
//     for "hex" it is passed on as written. background is 8 and matte 6 hexadecimal digits.
//   - A line that breaks these rules, or names an unknown kind, shape or frame, prints "<n>\tbad_case".
//     Everything else is the library's answer: "<n>\t<error name>" and, for ok, the base digest, the
//     fingerprint, the tag and the key check value (or "-"), and the file DIR/case-<n>.<format>. An
//     unknown format is invalid_argument, reported after every other error.
//
// The numeric options of a single render follow the same rule; a malformed one is a usage error.
//
// This is a demonstration and a test tool. A real host never takes a key from the command line, where
// other processes can read it.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";

import { BaseDigest, FIGURES, FRAME_STYLES, Fingerprint, HhError, HhImage, SHAPES, SecretKey } from "../src/index.js";
import type { FrameStyle, RenderOptions, Shape } from "../src/index.js";

const USAGE = `usage: hh-cli [options] <input>
  <input>               hexadecimal bytes (optional 0x), or text with --text
  --text                hash the input as UTF-8 text
  --key HEX             64 hex digits: render the keyed (private) picture
  --size N              16..1024 pixels (default 128)
  --shape NAME          square (default) or round
  --frame NAME          automatic (default), none, plain, rounded, chamfered, double,
                        thick, brackets, ticks, gaps
  --background RRGGBBAA background colour and alpha (default ffffffff)
  --frame-alpha N       0..255 (default 255)
  --format NAME         png (default), bmp, jpeg or rgba
  --quality N           JPEG quality 50..100 (default 92)
  --matte RRGGBB        what BMP and JPEG flatten transparency over (default ffffff)
  --out FILE            write the picture; without it only the values are printed
  --batch FILE DIR      run the cases of FILE, write case-<n>.<format> into DIR;
                        a case is 11 fields separated by spaces or tabs:
                        hex|text <input> <key|-> <size> <shape> <frame> <background>
                        <frame alpha> <format> <quality> <matte>
                        (the input of a text case is the hex form of its bytes;
                        numbers are 1 to 10 digits without a sign)
  --generate COUNT SEED print COUNT pseudo-random cases for --batch
`;

/** What one picture is made from. */
interface Request {
  /** The input: hexadecimal text, a text, or the UTF-8 bytes of a text. */
  input: { hex: string } | { text: string } | { utf8: Uint8Array };
  /** 64 hex digits, or undefined for the universal picture. */
  key: string | undefined;
  size: number;
  shape: Shape;
  frame: FrameStyle;
  backgroundRgb: number;
  backgroundAlpha: number;
  frameAlpha: number;
  format: string;
  quality: number;
  matteRgb: number;
}

interface Result {
  digest: BaseDigest;
  fingerprint: Fingerprint;
  /** The key check value as hex, or undefined for the universal picture. */
  kcv: string | undefined;
  bytes: Uint8Array;
}

function toHex(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("hex");
}

/** Strict hex: an even number of digits of either case, `bytes` of them if given. */
function fromHex(text: string, bytes?: number): Uint8Array | undefined {
  if (text.length % 2 !== 0 || !/^[0-9a-fA-F]*$/.test(text)) {
    return undefined;
  }
  return bytes === undefined || text.length === 2 * bytes ? Buffer.from(text, "hex") : undefined;
}

/**
 * 1 to 10 ASCII digits without a sign. Values beyond what the library takes are clamped to a value that is
 * just as invalid, as hh_cli does to keep its 32-bit variables from wrapping around.
 */
function parseNumber(text: string): number | undefined {
  return /^[0-9]{1,10}$/.test(text) ? Math.min(Number(text), 0x7fffffff) : undefined;
}

/** The fields of a line: what stands between runs of ASCII spaces and tabs. */
function splitFields(line: string): string[] {
  return line.split(/[ \t]+/).filter((field) => field !== "");
}

/** The order of hh_cli: the digest, the key, the render, the encoder, and only then the format name. */
function run(rq: Request): Result {
  const digest =
    "hex" in rq.input
      ? BaseDigest.ofHex(rq.input.hex)
      : "text" in rq.input
        ? BaseDigest.ofText(rq.input.text)
        : BaseDigest.ofUtf8(rq.input.utf8);
  let kcv: string | undefined;
  let fingerprint: Fingerprint;
  if (rq.key === undefined || rq.key === "") {
    fingerprint = Fingerprint.universal(digest);
  } else {
    const key = SecretKey.of(fromHex(rq.key) ?? new Uint8Array(0));
    try {
      kcv = toHex(key.checkValue);
      fingerprint = Fingerprint.keyed(digest, key);
    } finally {
      key.close();
    }
  }
  const options: RenderOptions = {
    shape: rq.shape,
    frame: rq.frame,
    backgroundRgb: rq.backgroundRgb,
    backgroundAlpha: rq.backgroundAlpha,
    frameAlpha: rq.frameAlpha,
  };
  const image = fingerprint.render(rq.size, options);
  return { digest, fingerprint, kcv, bytes: encode(image, rq) };
}

function encode(image: HhImage, rq: Request): Uint8Array {
  switch (rq.format) {
    case "png":
      return image.encodePng();
    case "bmp":
      return image.encodeBmp(rq.matteRgb);
    case "jpeg":
      return image.encodeJpeg(rq.quality, rq.matteRgb);
    case "rgba":
      return image.rgba;
    default:
      throw new UnknownFormat();
  }
}

/** hh_cli reports an unknown format as invalid_argument, after everything else has succeeded. */
class UnknownFormat extends Error {}

function errorName(e: unknown): string {
  if (e instanceof HhError) {
    return e.specName;
  }
  if (e instanceof UnknownFormat) {
    return "invalid_argument";
  }
  throw e;
}

/** One line of a case file as a request, or undefined for a bad case. */
function parseCase(line: string): Request | undefined {
  const f = splitFields(line);
  if (f.length !== 11 || (f[0] !== "hex" && f[0] !== "text")) {
    return undefined;
  }
  const [kind, input, key, size, shape, frame, background, frameAlpha, format, quality, matte] = f as [
    string, string, string, string, string, string, string, string, string, string, string,
  ];
  const utf8 = kind === "text" ? fromHex(input) : undefined;
  const sizeValue = parseNumber(size);
  const frameAlphaValue = parseNumber(frameAlpha);
  const qualityValue = parseNumber(quality);
  if (
    (kind === "text" && utf8 === undefined) ||
    sizeValue === undefined ||
    !(SHAPES as readonly string[]).includes(shape) ||
    !(FRAME_STYLES as readonly string[]).includes(frame) ||
    fromHex(background, 4) === undefined ||
    frameAlphaValue === undefined ||
    frameAlphaValue > 255 ||
    qualityValue === undefined ||
    fromHex(matte, 3) === undefined
  ) {
    return undefined;
  }
  return {
    input: utf8 !== undefined ? { utf8 } : { hex: input },
    key: key === "-" ? undefined : key,
    size: sizeValue,
    shape: shape as Shape,
    frame: frame as FrameStyle,
    backgroundRgb: Number.parseInt(background.slice(0, 6), 16),
    backgroundAlpha: Number.parseInt(background.slice(6), 16),
    frameAlpha: frameAlphaValue,
    format,
    quality: qualityValue,
    matteRgb: Number.parseInt(matte, 16),
  };
}

function batch(file: string, dir: string): number {
  let cases: string;
  try {
    // One character per byte: a case file is bytes, and no byte sequence is an error.
    cases = readFileSync(file, "latin1");
  } catch {
    process.stderr.write(`cannot read ${file}\n`);
    return 1;
  }
  try {
    mkdirSync(dir, { recursive: true });
  } catch {
    // Writing the first file reports it.
  }
  const lines: string[] = [];
  let number = 0;
  let failed = false;
  for (let line of cases.split("\n")) {
    if (line.endsWith("\r")) {
      line = line.slice(0, -1);
    }
    if (line === "" || line.startsWith("#")) {
      continue;
    }
    number++;
    const rq = parseCase(line);
    if (rq === undefined) {
      lines.push(`${number}\tbad_case`);
      continue;
    }
    let r: Result;
    try {
      r = run(rq);
    } catch (e) {
      lines.push(`${number}\t${errorName(e)}`);
      continue;
    }
    const values = [toHex(r.digest.toBytes()), toHex(r.fingerprint.toBytes()), r.fingerprint.tag, r.kcv ?? "-"];
    lines.push(`${number}\tok\t${values.join("\t")}`);
    try {
      writeFileSync(join(dir, `case-${number}.${rq.format}`), r.bytes);
    } catch {
      failed = true;
      break;
    }
  }
  process.stdout.write(lines.map((line) => `${line}\n`).join(""));
  if (failed) {
    process.stderr.write(`cannot write into ${dir}\n`);
    return 1;
  }
  return 0;
}

/**
 * The generator of SPEC.md section 15, `x = (x * 1103515245 + 12345) mod 2^31` with one byte per step:
 * the same seed gives the same cases on every platform.
 */
class Random {
  private x: number;

  constructor(seed: number) {
    this.x = seed & 0x7fffffff;
  }

  byte(): number {
    this.x = (Math.imul(this.x, 1103515245) + 12345) & 0x7fffffff;
    return (this.x >>> 16) & 0xff;
  }

  /** An integer in `0..bound-1`; `bound` is at most 2^16. */
  below(bound: number): number {
    return ((this.byte() << 8) | this.byte()) % bound;
  }

  chance(oneIn: number): boolean {
    return this.below(oneIn) === 0;
  }

  pick<T>(items: readonly T[]): T {
    return items[this.below(items.length)] as T;
  }

  hex(bytes: number): string {
    let out = "";
    for (let i = 0; i < bytes; i++) {
      out += this.byte().toString(16).padStart(2, "0");
    }
    return out;
  }
}

function generate(count: number, seed: number): void {
  const random = new Random(seed);
  const backgrounds = ["ffffffff", "ffffffff", "00000000", "00000000", "121212ff", "000000ff", "f2f2f2ff", "9e9e9eff"];
  const texts = ["bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4", "caf\u00e9 \u20ac \u{10348}", "T", "  spaced  "];
  const lines = [`# ${count} cases, seed ${seed}`];
  for (let i = 0; i < count; i++) {
    const text = random.chance(6);
    let input: string;
    if (text) {
      input = Buffer.from(random.pick(texts) + String(random.below(1000)), "utf8").toString("hex");
    } else if (random.chance(25)) {
      input = random.pick(["zz", "abc", "0x", "12_34"]);
    } else {
      input = (random.chance(2) ? "0x" : "") + random.hex(1 + random.below(40));
    }
    let key: string;
    switch (random.below(8)) {
      case 0:
      case 1:
      case 2:
        key = "-";
        break;
      case 3:
        key = random.chance(4) ? "00".repeat(32) : random.hex(31);
        break;
      default:
        key = random.hex(32);
    }
    const size = [15, 1025, 1024, 16][random.below(30)] ?? 17 + random.below(240);
    const background = random.chance(3) ? random.hex(4) : random.pick(backgrounds);
    const round = random.chance(2);
    // Mostly a frame that fits the mode and the shape, so that most cases render.
    const fitting: readonly string[] =
      key === "-"
        ? ["automatic", "none", "plain"]
        : round
          ? ["automatic", "none", "plain", "double", "thick", "ticks", "gaps"]
          : ["automatic", "none", "plain", "rounded", "chamfered", "double", "thick", "brackets"];
    const frame = random.chance(8) ? random.pick(FRAME_STYLES) : random.pick(fitting);
    const format = random.pick(["png", "png", "bmp", "jpeg", "rgba"]);
    const quality = random.chance(12) ? 40 + random.below(70) : 50 + random.below(51);
    const shape = round ? "round" : "square";
    const kind = text ? "text" : "hex";
    const frameAlpha = random.below(256);
    const matte = random.hex(3);
    lines.push([kind, input, key, size, shape, frame, background, frameAlpha, format, quality, matte].join(" "));
  }
  process.stdout.write(lines.map((line) => `${line}\n`).join(""));
}

/** The single render: the values on standard output, the picture into `--out`. */
function single(args: readonly string[]): number {
  const rq: Request = {
    input: { hex: "" },
    key: undefined,
    size: 128,
    shape: "square",
    frame: "automatic",
    backgroundRgb: 0xffffff,
    backgroundAlpha: 255,
    frameAlpha: 255,
    format: "png",
    quality: HhImage.DEFAULT_JPEG_QUALITY,
    matteRgb: 0xffffff,
  };
  let input: string | undefined;
  let text = false;
  let out: string | undefined;
  let formatGiven = false;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i] as string;
    if (arg === "--help" || arg === "-h") {
      process.stdout.write(USAGE);
      return 0;
    }
    if (arg === "--text") {
      text = true;
      continue;
    }
    if (!arg.startsWith("--")) {
      if (input !== undefined) {
        return usageError();
      }
      input = arg;
      continue;
    }
    const value = args[++i];
    if (value === undefined) {
      return usageError();
    }
    let ok = true;
    switch (arg) {
      case "--key":
        rq.key = value;
        break;
      case "--size": {
        const size = parseNumber(value);
        ok = size !== undefined;
        rq.size = size ?? 0;
        break;
      }
      case "--shape":
        ok = (SHAPES as readonly string[]).includes(value);
        rq.shape = value as Shape;
        break;
      case "--frame":
        ok = (FRAME_STYLES as readonly string[]).includes(value);
        rq.frame = value as FrameStyle;
        break;
      case "--background":
        ok = fromHex(value, 4) !== undefined;
        rq.backgroundRgb = Number.parseInt(value.slice(0, 6), 16);
        rq.backgroundAlpha = Number.parseInt(value.slice(6), 16);
        break;
      case "--frame-alpha": {
        const alpha = parseNumber(value);
        ok = alpha !== undefined && alpha <= 255;
        rq.frameAlpha = alpha ?? 0;
        break;
      }
      case "--format":
        rq.format = value;
        formatGiven = true;
        break;
      case "--quality": {
        const quality = parseNumber(value);
        ok = quality !== undefined;
        rq.quality = quality ?? 0;
        break;
      }
      case "--matte":
        ok = fromHex(value, 3) !== undefined;
        rq.matteRgb = Number.parseInt(value, 16);
        break;
      case "--out":
        out = value;
        break;
      default:
        ok = false;
    }
    if (!ok) {
      return usageError();
    }
  }
  if (input === undefined) {
    return usageError();
  }
  rq.input = text ? { text: input } : { hex: input };
  // Only these lower-case extensions name a format, and only in a path of more than four characters.
  if (!formatGiven && out !== undefined && out.length > 4) {
    const extension = out.slice(out.lastIndexOf(".") + 1);
    if (extension === "bmp" || extension === "rgba") {
      rq.format = extension;
    } else if (extension === "jpg" || extension === "jpeg") {
      rq.format = "jpeg";
    }
  }

  let r: Result;
  try {
    r = run(rq);
  } catch (e) {
    const name = errorName(e);
    const message = e instanceof HhError ? e.message : `the format ${rq.format} is not png, bmp, jpeg or rgba`;
    process.stderr.write(`error: ${name}: ${message}\n`);
    return 1;
  }
  const layout = r.fingerprint.layout();
  const tag = r.fingerprint.tag;
  const lines = [
    `mode         ${layout.mode}`,
    `base digest  ${toHex(r.digest.toBytes())}`,
    `fingerprint  ${toHex(r.fingerprint.toBytes())}`,
    `tag          ${tag.slice(0, 3)}-${tag.slice(3)}`,
  ];
  if (r.kcv !== undefined) {
    lines.push(`key check    ${r.kcv}`);
  }
  const symbols = [".", "S", "O", "^", ">", "v", "<"];
  for (let row = 0; row < 4; row++) {
    const cells = layout.cells
      .slice(4 * row, 4 * row + 4)
      .map((c) => `${symbols[FIGURES.indexOf(c.figure)]}${c.figure === "none" ? " " : c.colour} `);
    lines.push((row === 0 ? "cells        " : "             ") + cells.join(""));
  }
  if (out !== undefined) {
    writeFileSync(out, r.bytes);
    lines.push(`wrote        ${out} (${r.bytes.length} bytes)`);
  }
  process.stdout.write(lines.map((line) => `${line}\n`).join(""));
  return 0;
}

function usageError(): number {
  process.stderr.write(USAGE);
  return 2;
}

function main(args: readonly string[]): number {
  if (args[0] === "--batch" && args.length === 3) {
    return batch(args[1] as string, args[2] as string);
  }
  if (args[0] === "--generate" && args.length === 3) {
    const count = parseNumber(args[1] as string);
    const seed = parseNumber(args[2] as string);
    if (count === undefined || seed === undefined) {
      return usageError();
    }
    generate(count, seed);
    return 0;
  }
  return single(args);
}

process.exitCode = main(process.argv.slice(2));
