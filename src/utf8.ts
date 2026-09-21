// UTF-8 encoding of JavaScript strings. A string is a sequence of UTF-16 code units and may hold unpaired
// surrogates, which have no UTF-8 encoding; the library must reject them instead of replacing them
// (section 3 of the specification), so it cannot use an encoder that substitutes U+FFFD.

/** What {@link measureUtf8} reports. */
export interface Utf8Measure {
  /** The number of bytes of the encoding; an unpaired surrogate counts as the 3 bytes of its code unit. */
  readonly length: number;
  /** False if the text holds an unpaired surrogate. */
  readonly wellFormed: boolean;
}

function isHighSurrogate(unit: number): boolean {
  return unit >= 0xd800 && unit <= 0xdbff;
}

function isLowSurrogate(unit: number): boolean {
  return unit >= 0xdc00 && unit <= 0xdfff;
}

/** Measures the UTF-8 encoding of `text` without producing it. */
export function measureUtf8(text: string): Utf8Measure {
  let length = 0;
  let wellFormed = true;
  for (let i = 0; i < text.length; i++) {
    const unit = text.charCodeAt(i);
    if (unit < 0x80) {
      length += 1;
    } else if (unit < 0x800) {
      length += 2;
    } else if (isHighSurrogate(unit) && i + 1 < text.length && isLowSurrogate(text.charCodeAt(i + 1))) {
      length += 4;
      i++;
    } else {
      length += 3;
      if (unit >= 0xd800 && unit <= 0xdfff) {
        wellFormed = false;
      }
    }
  }
  return { length, wellFormed };
}

/**
 * The UTF-8 encoding of a well-formed `text`, `length` bytes as {@link measureUtf8} reported: no byte
 * order mark, no normalisation, no terminator.
 */
export function encodeUtf8(text: string, length: number): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(length);
  let p = 0;
  for (let i = 0; i < text.length; i++) {
    let point = text.charCodeAt(i);
    if (isHighSurrogate(point)) {
      point = 0x10000 + ((point - 0xd800) << 10) + (text.charCodeAt(++i) - 0xdc00);
    }
    if (point < 0x80) {
      out[p++] = point;
    } else if (point < 0x800) {
      out[p++] = 0xc0 | (point >>> 6);
      out[p++] = 0x80 | (point & 0x3f);
    } else if (point < 0x10000) {
      out[p++] = 0xe0 | (point >>> 12);
      out[p++] = 0x80 | ((point >>> 6) & 0x3f);
      out[p++] = 0x80 | (point & 0x3f);
    } else {
      out[p++] = 0xf0 | (point >>> 18);
      out[p++] = 0x80 | ((point >>> 12) & 0x3f);
      out[p++] = 0x80 | ((point >>> 6) & 0x3f);
      out[p++] = 0x80 | (point & 0x3f);
    }
  }
  return out;
}
