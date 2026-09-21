// CRC-32 (ISO 3309, as the PNG specification uses it) and Adler-32 (RFC 1950).

/** The CRC of each byte value: the reflected polynomial EDB88320. */
const CRC_TABLE = new Int32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) {
    c = (c & 1) !== 0 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  CRC_TABLE[n] = c;
}

/** The CRC-32 of the concatenation of `parts`, as an unsigned 32-bit value. */
export function crc32(...parts: Uint8Array[]): number {
  let crc = -1;
  for (const part of parts) {
    for (let i = 0; i < part.length; i++) {
      crc = CRC_TABLE[(crc ^ part[i]) & 0xff] ^ (crc >>> 8);
    }
  }
  return ~crc >>> 0;
}

/** The Adler-32 of `data`, as an unsigned 32-bit value. */
export function adler32(data: Uint8Array): number {
  let a = 1;
  let b = 0;
  let pos = 0;
  // zlib reduces every 5552 bytes, the largest block for which the sums fit 32 bits. `%` is exact for
  // non-negative integers.
  while (pos < data.length) {
    const end = Math.min(data.length, pos + 5552);
    while (pos < end) {
      a += data[pos++];
      b += a;
    }
    a %= 65521;
    b %= 65521;
  }
  return ((b << 16) | a) >>> 0;
}
