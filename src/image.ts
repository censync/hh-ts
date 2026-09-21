import { encodeBmp } from "./bmp.js";
import { HhError, HhErrorCode, orNull } from "./errors.js";
import { encodeJpeg } from "./jpeg.js";
import { byteCount, copyOfSize, isIntegerIn } from "./model.js";
import { checkColour } from "./options.js";
import { encodePng } from "./png.js";

/**
 * Pixels, not pictures: `width * height` RGBA pixels with straight (non-premultiplied) alpha, row-major
 * from the top left. Turning them into a platform image belongs to the host:
 *
 * ```ts
 * const pixels = new Uint8ClampedArray(image.rgba.buffer);
 * context.putImageData(new ImageData(pixels, image.width, image.height), 0, 0);
 * ```
 *
 * The encoders are deterministic: the same image gives the same bytes in every implementation of hh.
 * An image is frozen; the bytes of {@link HhImage.rgba} stay writable, as those of every typed array.
 *
 * Transferring `image.rgba.buffer`, to a worker or with `ArrayBuffer.prototype.transfer`, detaches it and
 * leaves the image without pixels; the encoders then throw `invalid_image`. Encode first, or transfer a
 * copy.
 */
export class HhImage {
  /** The JPEG quality used when none is given. */
  static readonly DEFAULT_JPEG_QUALITY = 92;

  /** The largest width and height the encoders accept. */
  static readonly MAX_DIMENSION = 4096;

  /** The width in pixels. */
  readonly width: number;

  /** The height in pixels. */
  readonly height: number;

  /**
   * The pixels, 4 bytes each in the order R, G, B, A. The array is the image's own and spans its whole
   * `ArrayBuffer`, so `new Uint8ClampedArray(image.rgba.buffer)` is a view of the same pixels without a copy.
   */
  readonly rgba: Uint8Array<ArrayBuffer>;

  private constructor(width: number, height: number, rgba: Uint8Array<ArrayBuffer>) {
    this.width = width;
    this.height = height;
    this.rgba = rgba;
    Object.freeze(this);
  }

  /**
   * 8-bit truecolour PNG; with alpha only if some pixel is not opaque.
   *
   * @throws {@link HhError} with `invalid_image` if the pixel buffer was detached.
   */
  encodePng(): Uint8Array<ArrayBuffer> {
    return encodePng(this.width, this.height, this.#pixels());
  }

  /**
   * 24-bit BMP; transparent pixels are flattened over `matteRgb` (`0xRRGGBB`).
   *
   * @throws {@link HhError} with `invalid_image` if the pixel buffer was detached, then with
   * `invalid_argument` unless `matteRgb` is an integer `0..0xFFFFFF`.
   */
  encodeBmp(matteRgb = 0xffffff): Uint8Array<ArrayBuffer> {
    const rgba = this.#pixels();
    checkColour(matteRgb);
    return encodeBmp(this.width, this.height, rgba, matteRgb);
  }

  /**
   * Baseline JFIF, 4:4:4; transparent pixels are flattened over `matteRgb`. Offered for compatibility:
   * JPEG rings on flat colour edges, prefer PNG.
   *
   * @throws {@link HhError} with `invalid_image` if the pixel buffer was detached, then with
   * `invalid_quality` unless `quality` is an integer 50..100, then with `invalid_argument` unless
   * `matteRgb` is an integer `0..0xFFFFFF`.
   */
  encodeJpeg(quality = HhImage.DEFAULT_JPEG_QUALITY, matteRgb = 0xffffff): Uint8Array<ArrayBuffer> {
    const rgba = this.#pixels();
    if (!isIntegerIn(quality, 50, 100)) {
      throw new HhError(HhErrorCode.INVALID_QUALITY, "the JPEG quality is an integer 50..100");
    }
    checkColour(matteRgb);
    return encodeJpeg(this.width, this.height, rgba, quality, matteRgb);
  }

  /** The pixels, unless their buffer was detached and the array is empty. */
  #pixels(): Uint8Array<ArrayBuffer> {
    if (byteCount(this.rgba) !== this.width * this.height * 4) {
      throw new HhError(HhErrorCode.INVALID_IMAGE, "the pixel buffer was detached");
    }
    return this.rgba;
  }

  /**
   * Wraps pixels that did not come from `Fingerprint.render`, to use the encoders on them. The pixels are
   * copied.
   *
   * @throws {@link HhError} with `invalid_image` unless the dimensions are integers 1..4096 and `rgba` is
   * a `Uint8Array` of `width * height * 4` bytes.
   */
  static ofRgba(width: number, height: number, rgba: Uint8Array): HhImage {
    const max = HhImage.MAX_DIMENSION;
    const pixels =
      isIntegerIn(width, 1, max) && isIntegerIn(height, 1, max) ? copyOfSize(rgba, width * height * 4) : undefined;
    if (pixels === undefined) {
      throw new HhError(
        HhErrorCode.INVALID_IMAGE,
        `the dimensions are 1..${max} and the buffer has width * height * 4 bytes`,
      );
    }
    return new HhImage(width, height, pixels);
  }

  /** {@link HhImage.ofRgba}, or `null` instead of an exception. */
  static ofRgbaOrNull(width: number, height: number, rgba: Uint8Array): HhImage | null {
    return orNull(() => HhImage.ofRgba(width, height, rgba));
  }

  /**
   * Takes ownership of pixels the library itself produced.
   *
   * @internal
   */
  static wrap(width: number, height: number, rgba: Uint8Array<ArrayBuffer>): HhImage {
    return new HhImage(width, height, rgba);
  }
}
