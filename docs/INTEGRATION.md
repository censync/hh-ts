# Integration

How to put `@censync/hh` into an application. What to hash, which mode to show where and how
large a picture must be are the same for every implementation and are described once, in
[INTEGRATION.md of hh-cpp](https://github.com/censync/hh-cpp/blob/v1.1.0/docs/INTEGRATION.md)
(sections 1 to 4: recommended inputs per chain, the product rules, the looks). This document adds
the JavaScript side.

## 1. The three steps and what to cache

```ts
import { BaseDigest, Fingerprint } from "@censync/hh";

const digest = BaseDigest.ofHex(address); // slow, public: cache digest.toBytes()
const fingerprint = Fingerprint.keyed(digest, key); // one HMAC; or Fingerprint.universal(digest)
const image = fingerprint.render(sizePx, options); // fast
```

- The base digest costs about 16 000 HMAC calls: about 11 ms on a desktop core under V8, and
  several times that on a phone. It runs synchronously, so it blocks the thread it runs on;
  section 5 moves it into a Web Worker.
- Cache the 32 bytes per input (`BaseDigest.toBytes`, `BaseDigest.fromBytes`). The digest is
  public and needs no protection, so any store will do:

  ```ts
  const digests = new Map<string, Uint8Array>(); // or IndexedDB, which stores a Uint8Array as it is

  function baseDigest(addressHex: string): BaseDigest {
    const id = addressHex.toLowerCase().replace(/^0x/, ""); // every spelling is one input
    const cached = digests.get(id);
    if (cached !== undefined) {
      return BaseDigest.fromBytes(cached);
    }
    const digest = BaseDigest.ofHex(addressHex);
    digests.set(id, digest.toBytes());
    return digest;
  }
  ```

- The first call of a page is slower than the rest, until the engine has compiled the hash.
- Changing the key or the mode never needs the slow step again. A 128-pixel render takes well
  under a millisecond, its PNG about a third of one; `npm run bench` prints the numbers for your
  machine.
- Inputs: bytes go to `BaseDigest.of`, hexadecimal text (any case, with or without `0x`) to
  `BaseDigest.ofHex`, text-only formats such as bech32 to `BaseDigest.ofText`. `BaseDigest.ofUtf8`
  takes a text that is already encoded. A text with an unpaired surrogate has no UTF-8 encoding
  and is refused with `invalid_argument` instead of being repaired.

## 2. Browsers

The library hands over RGBA bytes with straight alpha, which is exactly what `ImageData` holds.
`image.rgba` spans its whole `ArrayBuffer`, so the view below shares the pixels without a copy:

```ts
function draw(canvas: HTMLCanvasElement, fingerprint: Fingerprint, cssSize: number): void {
  const size = Math.min(1024, Math.max(16, Math.round(cssSize * window.devicePixelRatio)));
  const image = fingerprint.render(size, { backgroundAlpha: 0 });
  canvas.width = size;
  canvas.height = size;
  canvas.style.width = canvas.style.height = `${cssSize}px`;
  const pixels = new ImageData(new Uint8ClampedArray(image.rgba.buffer), size, size);
  canvas.getContext("2d")!.putImageData(pixels, 0, 0);
}
```

Render at the exact device-pixel size instead of letting the browser scale: the rasteriser is
anti-aliased for the size it is asked for. For an `<img>`, or for a download, encode a PNG:

```ts
const url = URL.createObjectURL(new Blob([image.encodePng()], { type: "image/png" }));
img.src = url; // URL.revokeObjectURL(url) once the element is gone
```

The PNG bytes are the same in every implementation of hh, which makes them fit for export and
for comparison by hash. Exported or shared pictures are always universal.

An image owns its `ArrayBuffer`. Transferring that buffer, in the transfer list of `postMessage`
or with `ArrayBuffer.prototype.transfer`, detaches it and leaves the image without pixels; the
encoders then throw `invalid_image` instead of encoding a black square. Encode before the
transfer, or transfer a copy (`image.rgba.slice().buffer`).

Give the picture an accessible name that says which mode it shows ("Private picture of this
address"); the tag (`fingerprint.tag`, shown as `K7Q-M2X`) is the text alternative to the picture
itself.

## 3. Node.js, Deno, Bun

```ts
import { writeFile } from "node:fs/promises";
import { BaseDigest, Fingerprint } from "@censync/hh";

const fingerprint = Fingerprint.universal(BaseDigest.ofHex(process.argv[2] ?? ""));
await writeFile("address.png", fingerprint.render(256).encodePng());
console.log(fingerprint.tag);
```

The package is ESM only; CommonJS code loads it with `await import("@censync/hh")`, or with
`require` on Node.js 20.19 or newer and 22.12 or newer, which can require ES modules. A `Buffer`
is a `Uint8Array` and is accepted wherever bytes are. `cli/hh-cli.ts` in the repository is a
complete command line tool.

## 4. React

```tsx
import { useEffect, useRef } from "react";
import type { Fingerprint, RenderOptions } from "@censync/hh";

interface HashImageProps {
  fingerprint: Fingerprint;
  /** CSS pixels. */
  size: number;
  /** Keep the identity stable: a constant, or `useMemo`. */
  options?: RenderOptions;
  label: string;
}

export function HashImage({ fingerprint, size, options, label }: HashImageProps) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (canvas === null) {
      return;
    }
    const px = Math.min(1024, Math.max(16, Math.round(size * window.devicePixelRatio)));
    const image = fingerprint.renderOrNull(px, options);
    canvas.width = canvas.height = px; // also clears the canvas
    if (image !== null) {
      const pixels = new ImageData(new Uint8ClampedArray(image.rgba.buffer), px, px);
      canvas.getContext("2d")?.putImageData(pixels, 0, 0);
    }
  }, [fingerprint, size, options]);
  return <canvas ref={ref} role="img" aria-label={label} style={{ width: size, height: size }} />;
}
```

Create the fingerprint outside the component or in `useMemo`, from the cached digest bytes, so
that the effect runs only when the address, the key or the size changes:

```tsx
const fingerprint = useMemo(
  () => Fingerprint.universal(BaseDigest.fromBytes(digestBytes)),
  [digestBytes],
);
```

Rendering is fast enough for an effect. The base digest is not: compute it before the component
renders, in a worker or while the address book loads.

## 5. The digest in a Web Worker

A list of fifty new addresses is half a second of hashing. A module worker keeps that off the UI
thread. Class instances do not survive `postMessage`, bytes do, so the worker answers with
`toBytes()` and the page restores the digest with `fromBytes`:

```ts
// digest-worker.ts
import { BaseDigest } from "@censync/hh";

self.onmessage = (event: MessageEvent<{ id: number; hex: string }>) => {
  const bytes = BaseDigest.ofHexOrNull(event.data.hex)?.toBytes() ?? null;
  self.postMessage({ id: event.data.id, bytes });
};
```

```ts
// page
const worker = new Worker(new URL("./digest-worker.js", import.meta.url), { type: "module" });
const pending = new Map<number, (bytes: Uint8Array | null) => void>();
let nextId = 0;

worker.onmessage = (event: MessageEvent<{ id: number; bytes: Uint8Array | null }>) => {
  pending.get(event.data.id)?.(event.data.bytes);
  pending.delete(event.data.id);
};

function digestInWorker(hex: string): Promise<BaseDigest | null> {
  return new Promise((resolve) => {
    const id = nextId++;
    pending.set(id, (bytes) => resolve(bytes === null ? null : BaseDigest.fromBytes(bytes)));
    worker.postMessage({ id, hex });
  });
}
```

The worker only ever sees public data. The key stays where it is, and the keyed fingerprint,
one HMAC, is computed on the page from the digest the worker returns. In Node.js the same split
works with `node:worker_threads`.

## 6. Keyed mode and where the key may live

The key is 32 bytes that are uniformly random or the output of a key derivation function, best
derived from the wallet seed on a dedicated path, so that it needs no storage of its own and
survives a restore (SECURITY.md of hh-cpp, section "The key"). Store the key check value beside
your cached data and compare it when the wallet unlocks: a different value means every private
picture is about to change, which the user must be told.

```ts
const key = SecretKey.of(keyBytes);
keyBytes.fill(0); // the library made its own copy
try {
  const fingerprint = Fingerprint.keyed(digest, key);
  const kcv = key.checkValue; // 4 bytes
} finally {
  key.close(); // or keep the key while the wallet is unlocked and close it on lock
}
```

What `close()` does and does not do. It overwrites the library's copy of the key with zeros, and
a closed key (`key.closed` is `true`) refuses to work: `Fingerprint.keyed` throws `invalid_key`.
The key check value is public, so it is computed when the key is created and `key.checkValue`
stays readable after `close()`. Closing cannot do more than that in JavaScript: the engine may have
copied the array while moving it between generations of its heap, a garbage-collected heap is not
wiped when memory is released, a string is immutable and cannot be wiped at all (so never hold the
key as a hex or base64 string longer than it takes to decode it), and `postMessage` clones what it
sends. `SecretKey` keeps the bytes in a private field, out of `console.log`, `JSON.stringify` and
error reports, which is where keys leak in practice.

Where the key may live in a web application, from best to worst:

1. **Outside the JavaScript heap.** Import the key into WebCrypto as a non-extractable HMAC key,
   wipe the bytes, and let the browser compute the one HMAC of keyed mode. The library then never
   sees the key, only the 32 result bytes:

   ```ts
   const hmacKey = await crypto.subtle.importKey(
     "raw", keyBytes, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
   keyBytes.fill(0);

   async function keyedFingerprint(digest: BaseDigest): Promise<Fingerprint> {
     // M2 of the specification: "HumanizedHash" || 00 || 02 || s
     const m2 = new Uint8Array(47);
     m2.set(new TextEncoder().encode("HumanizedHash"));
     m2[14] = 0x02;
     m2.set(digest.toBytes(), 15);
     const tag = await crypto.subtle.sign("HMAC", hmacKey, m2);
     return Fingerprint.fromBytes(new Uint8Array(tag), "keyed");
   }
   ```

   The key check value is the first 4 bytes of the HMAC of `"HumanizedHash" || 00 || 03`. A
   non-extractable `CryptoKey` can be kept in IndexedDB across sessions. The same pattern serves
   a hardware wallet, a secure element or a native host: whoever holds the key computes the HMAC,
   and `Fingerprint.fromBytes` takes the result. The golden vectors guarantee that every
   implementation draws the same picture from it.
2. **In memory while the wallet is unlocked.** Derive the key on unlock, keep the `SecretKey` in
   the same place as the other unlocked secrets, close it on lock. In a browser extension that
   place is the background service worker or an offscreen document: render there and send pixels
   or PNG bytes to the popup; content scripts and web pages never get the key.
3. **Persisted**, only inside the wallet's encrypted vault, under the same protection as the
   seed. Never in `localStorage`, `sessionStorage`, a cookie or a URL, and never in plain
   IndexedDB.

Script injection defeats all three: code that runs in the wallet's origin can ask for keyed
pictures like the wallet itself, and with option 2 it can read the key. hh does not change what a
web wallet has to do about its supply chain and its content security policy. Keyed mode is never
weaker than universal mode, even if the key leaks, because stretching precedes keying.

## 7. Looks and contrast

```ts
import { measureContrast, type RenderOptions } from "@censync/hh";

const options: RenderOptions = {
  shape: "round",
  frame: "double", // any style of the shape, in either mode
  backgroundRgb: 0x121212,
  backgroundAlpha: 255,
  frameAlpha: 255,
};
const report = measureContrast(options, 0x121212);
if (report.figuresX100 < 300) {
  // warn the user: figures may be hard to see
}
```

Every option has a default: a square picture on opaque white, with the `automatic` frame, which
is `rounded` for a keyed fingerprint with the square shape and `none` otherwise: a universal
picture has no frame, and neither has a round one. Every style is open to both modes: `none`,
`plain`, `double` and `thick` fit either shape, `rounded`, `chamfered` and `brackets` the square,
`ticks` and `gaps` the round shape; a style that does not fit the shape is `invalid_frame`. A host
that marks its keyed pictures with a frame uses one style everywhere in the application and on
every device of a user: a marker is only useful if it is familiar. The library does not enforce
the marker, so the caption, not the frame, is what tells the user the mode.

An options object with a property that is not an option, such as the misspelt `backgroundRGB`, is
refused with `invalid_argument` by `render`, `renderOrNull` (which returns `null`) and
`measureContrast`, so that a typing mistake does not silently render the default. Only the
object's own enumerable string keys are looked at.

Rendering refuses an opaque background with less than 2:1 against any palette colour
(`low_contrast`). For a translucent background pass the colour of the surface underneath as the
second argument of `measureContrast`. On a dark theme use `{ backgroundAlpha: 0 }` over a dark
surface or an opaque dark background; avoid mid greys and saturated surfaces. Outside rounded or
chamfered corners and outside the disc the picture is always transparent. `fingerprint.layout()`
gives the cells and the colours to hosts that draw vectors themselves; only the raster is covered
by byte-exact vectors.

Sizes are device pixels, 16 to 1024. A picture that backs a decision is at least 64 CSS pixels,
better 96, and about a third larger in the round shape, whose cells are smaller; 32 to 48 CSS
pixels are for recognition in list rows.

## 8. Errors

Every error is an `HhError` with the numeric `code` of the specification (the values of the C ABI
of hh-cpp, also in `HhErrorCode`) and its name in the specification, `specName`. The message is
for logs.

| Call | `specName` (`code`) |
|---|---|
| `BaseDigest.of`, `ofUtf8` | `empty_input` (1), `input_too_large` (2), `invalid_argument` (14) if the input is not a `Uint8Array` |
| `BaseDigest.ofHex` | `invalid_hex` (3), then `input_too_large` (2); `invalid_argument` (14) if the input is not a string |
| `BaseDigest.ofText` | `empty_input` (1), `input_too_large` (2), then `invalid_argument` (14) for an unpaired surrogate or a value that is not a string |
| `BaseDigest.fromBytes` | `invalid_digest` (5) |
| `SecretKey.of` | `invalid_key` (4) |
| `Fingerprint.universal`, `keyed` | `invalid_digest` (5), then `invalid_key` (4), also for a closed key |
| `Fingerprint.fromBytes` | `invalid_fingerprint` (6): not 32 bytes, or an unknown mode |
| `Fingerprint.render` | `invalid_argument` (14) for a property that is not an option or a value that is unknown or out of range, then `invalid_size` (7), `invalid_frame` (8) if the frame style does not fit the shape, `low_contrast` (9), `invalid_size` (7) if no cell fits |
| `HhImage.ofRgba` | `invalid_image` (11) |
| `HhImage.encodePng` | `invalid_image` (11) if the pixel buffer was detached |
| `HhImage.encodeBmp` | `invalid_image` (11) if the pixel buffer was detached, then `invalid_argument` (14) for the matte |
| `HhImage.encodeJpeg` | `invalid_image` (11) if the pixel buffer was detached, then `invalid_quality` (10), then `invalid_argument` (14) for the matte |
| `measureContrast` | `invalid_argument` (14) for a property that is not an option, a colour outside `0..0xFFFFFF` or an alpha outside `0..255` |

The functions that take outside data have `...OrNull` forms that return `null` instead:
`BaseDigest.ofOrNull`, `ofHexOrNull`, `ofTextOrNull`, `ofUtf8OrNull`, `fromBytesOrNull`,
`SecretKey.ofOrNull`, `Fingerprint.keyedOrNull`, `fromBytesOrNull`, `renderOrNull`,
`HhImage.ofRgbaOrNull`. Values of the wrong type, as untyped JavaScript may pass them, give the
same errors; the library throws nothing else, apart from a `RangeError` of the engine when memory
runs out. Bytes are a real `Uint8Array` (a `Buffer` and other subclasses included, from any
realm): an object that only claims to be one, a `Proxy` of one, another typed array, a `DataView`
and an `ArrayBuffer` are refused. The library copies the bytes it is given and counts the bytes
of its copy, so a subclass that misreports its `length` changes nothing.

The codes 12 (`buffer_too_small`) and 13 (`out_of_memory`) of the specification belong to
caller-allocated buffers and do not occur here.

## 9. State and concurrency

The library keeps no mutable global state, reads no clock and no random numbers, and touches
nothing outside its arguments. `BaseDigest`, `Fingerprint` and `HhImage` are immutable: the
objects are frozen, the bytes of a digest and of a fingerprint live in private fields and leave
only as copies (`toBytes()`), and `mode` and `tag` are read-only. The exception is that the bytes
of `HhImage.rgba` are writable like those of any typed array; a render returns a new array every
time. `SecretKey` changes once, when it is closed. The exported lists `MODES`, `SHAPES`,
`FRAME_STYLES` and `FIGURES` and the `HhErrorCode` object are frozen, and validation does not
depend on them. Every call is synchronous.

## 10. Conformance

`npm test` reproduces every record of `testdata/vectors.tsv` and every file of
`testdata/golden/`, and compares the renderer with a per-sample implementation of the
specification. `tools/crosscheck.sh` compares thousands of pseudo-random cases, valid and
invalid, and the hand-made cases of `tools/edge-cases.txt` with `hh_cli` of hh-cpp byte for byte.
A mismatch is a bug in this implementation, never a reason to change the vectors.
