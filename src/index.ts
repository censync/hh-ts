/**
 * Humanized Hash (hh): a small deterministic picture of a blockchain address, a public key or any hash,
 * made to be compared at a glance.
 *
 * ```ts
 * import { BaseDigest, Fingerprint } from "@censync/hh";
 *
 * const digest = BaseDigest.ofHex("0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed"); // slow: cache it
 * const fingerprint = Fingerprint.universal(digest); // or Fingerprint.keyed(digest, key)
 * const image = fingerprint.render(128); // 128 x 128 RGBA pixels
 * const png = image.encodePng();
 * ```
 *
 * The library uses no platform API and integer arithmetic only; its output is byte-identical with the
 * C++ reference implementation hh-cpp, which owns the specification.
 *
 * @packageDocumentation
 */

export { BaseDigest } from "./base-digest.js";
export { HhError, HhErrorCode } from "./errors.js";
export type { HhErrorName } from "./errors.js";
export { Fingerprint } from "./fingerprint.js";
export { HhImage } from "./image.js";
export { FIGURES, FRAME_STYLES, MODES, SHAPES } from "./model.js";
export type { Cell, Figure, FrameStyle, Layout, Mode, Shape } from "./model.js";
export { measureContrast } from "./options.js";
export type { ContrastReport, RenderOptions } from "./options.js";
export { SecretKey } from "./secret-key.js";

/** The version of this library. It never affects the output: the algorithm has no version. */
export const VERSION = "1.0.0";
