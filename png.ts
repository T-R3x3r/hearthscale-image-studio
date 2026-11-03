const SIGNATURE = 8;
const TEXT_CHUNKS = new Set(['tEXt', 'iTXt', 'zTXt']);

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const byte of bytes) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

/** An uncompressed iTXt chunk: a Latin-1 keyword and UTF-8 text. */
function itxt(keyword: string, text: string): Uint8Array {
  const key = Uint8Array.from(keyword, (c) => c.charCodeAt(0));
  const body = new TextEncoder().encode(text);
  const data = new Uint8Array(key.length + 5 + body.length);
  data.set(key, 0);
  data.set(body, key.length + 5);
  return chunk('iTXt', data);
}

function keywordOf(data: Uint8Array): string {
  const end = data.indexOf(0);
  return String.fromCharCode(...data.subarray(0, end < 0 ? data.length : end));
}

/** A PNG with its text chunks replaced: the ones whose keyword `keep`
 *  names stay, every other one goes, and `text` is added after the header. */
export function withText(png: Uint8Array, keep: Set<string>, text: Record<string, string>): Uint8Array {
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  const parts: Uint8Array[] = [png.subarray(0, SIGNATURE)];
  for (let at = SIGNATURE; at < png.length;) {
    const length = view.getUint32(at);
    const type = String.fromCharCode(...png.subarray(at + 4, at + 8));
    const whole = png.subarray(at, at + 12 + length);
    const dropped = TEXT_CHUNKS.has(type) && !keep.has(keywordOf(png.subarray(at + 8, at + 8 + length)));
    if (!dropped) parts.push(whole);
    if (type === 'IHDR') for (const [keyword, words] of Object.entries(text)) parts.push(itxt(keyword, words));
    at += 12 + length;
  }
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}
