// Timings of the steps a host pays for: the base digest, the keyed fingerprint, rendering and the three
// encoders. One thread, wall-clock time; the median over the runs is what a host sees once the engine
// has compiled the code, the first call is what it sees for its first picture.
//
//   npm run bench

import process from "node:process";

import { BaseDigest, Fingerprint, SecretKey } from "../src/index.js";

interface Timing {
  readonly first: number;
  readonly median: number;
  readonly min: number;
}

/** Runs `block` `runs` times and reports milliseconds. */
function time(runs: number, block: (run: number) => unknown): Timing {
  const times: number[] = [];
  let sink = 0;
  for (let run = 0; run < runs; run++) {
    const start = process.hrtime.bigint();
    const result = block(run);
    times.push(Number(process.hrtime.bigint() - start) / 1e6);
    sink += result === undefined ? 0 : 1;
  }
  if (sink !== runs) {
    throw new Error("a benchmarked block returned nothing");
  }
  const first = times[0] as number;
  times.sort((a, b) => a - b);
  return { first, median: times[times.length >> 1] as number, min: times[0] as number };
}

function report(name: string, t: Timing): void {
  const cells = [t.median, t.min, t.first].map((ms) => ms.toFixed(3).padStart(10));
  process.stdout.write(`${name.padEnd(34)}${cells.join("")}\n`);
}

/** A deterministic 20-byte address. */
function address(i: number): Uint8Array {
  return Uint8Array.from({ length: 20 }, (_, k) => (i * 131 + k * 17 + 7) & 0xff);
}

process.stdout.write(`# hh benchmark, one thread; Node.js ${process.version}, ${process.platform} ${process.arch}\n`);
const headings = ["median ms", "min ms", "first ms"].map((heading) => heading.padStart(10));
process.stdout.write(`${"step".padEnd(34)}${headings.join("")}\n`);

report("base digest (20 bytes)", time(60, (run) => BaseDigest.of(address(run))));

const digest = BaseDigest.of(address(0));
const key = SecretKey.of(Uint8Array.from({ length: 32 }, (_, i) => i + 1));
report("keyed fingerprint", time(2000, () => Fingerprint.keyed(digest, key)));
const universal = Fingerprint.universal(digest);
const keyed = Fingerprint.keyed(digest, key);
key.close();

for (const size of [48, 128, 256, 1024]) {
  const runs = size > 256 ? 20 : 200;
  report(`render ${size} px, square, universal`, time(runs, () => universal.render(size)));
  report(`render ${size} px, square, keyed`, time(runs, () => keyed.render(size)));
  const ticks = { shape: "round", frame: "ticks" } as const;
  report(`render ${size} px, round, keyed, ticks`, time(runs, () => keyed.render(size, ticks)));
}

for (const size of [128, 256, 1024]) {
  const runs = size > 256 ? 20 : 200;
  const image = keyed.render(size, { backgroundAlpha: 0 });
  const opaque = universal.render(size);
  report(`PNG ${size} px, opaque`, time(runs, () => opaque.encodePng()));
  report(`PNG ${size} px, with alpha`, time(runs, () => image.encodePng()));
  report(`BMP ${size} px`, time(runs, () => image.encodeBmp()));
  report(`JPEG ${size} px, quality 92`, time(runs, () => image.encodeJpeg()));
}
