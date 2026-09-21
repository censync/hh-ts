/** A growable byte buffer for the encoders. Values are stored modulo 256, as a `Uint8Array` does. */
export class ByteSink {
  private buffer: Uint8Array<ArrayBuffer>;
  private used = 0;

  /** Creates a sink with room for `capacity` bytes; it grows as needed. */
  constructor(capacity = 1024) {
    this.buffer = new Uint8Array(Math.max(16, capacity));
  }

  /** The number of bytes written. */
  get size(): number {
    return this.used;
  }

  private reserve(count: number): void {
    if (this.used + count > this.buffer.length) {
      const grown = new Uint8Array(Math.max(2 * this.buffer.length, this.used + count));
      grown.set(this.buffer.subarray(0, this.used));
      this.buffer = grown;
    }
  }

  /** Appends one byte. */
  put(value: number): void {
    this.reserve(1);
    this.buffer[this.used++] = value;
  }

  /** Appends `bytes`. */
  putAll(bytes: ArrayLike<number>): void {
    this.reserve(bytes.length);
    this.buffer.set(bytes, this.used);
    this.used += bytes.length;
  }

  /** Appends the bytes of an ASCII string. */
  putAscii(text: string): void {
    for (let i = 0; i < text.length; i++) {
      this.put(text.charCodeAt(i));
    }
  }

  /** Appends `u16be(value)`. */
  putBe16(value: number): void {
    this.put(value >>> 8);
    this.put(value);
  }

  /** Appends `u32be(value)`. */
  putBe32(value: number): void {
    this.putBe16(value >>> 16);
    this.putBe16(value);
  }

  /** Appends `u16le(value)`. */
  putLe16(value: number): void {
    this.put(value);
    this.put(value >>> 8);
  }

  /** Appends `u32le(value)`. */
  putLe32(value: number): void {
    this.putLe16(value);
    this.putLe16(value >>> 16);
  }

  /** The bytes written so far, as a view of the sink's buffer: valid until the next write. */
  view(): Uint8Array<ArrayBuffer> {
    return this.buffer.subarray(0, this.used);
  }

  /** The bytes written, in a buffer of exactly their size. The sink must not be written to afterwards. */
  toBytes(): Uint8Array<ArrayBuffer> {
    return this.used === this.buffer.length ? this.buffer : this.buffer.slice(0, this.used);
  }
}
